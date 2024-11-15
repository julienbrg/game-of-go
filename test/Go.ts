import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { expect } from "chai"
import { ethers } from "hardhat"

describe("Go Contract", function () {
    async function deployGoFixture() {
        const [deployer, white, black, attacker] = await ethers.getSigners()
        const Go = await ethers.getContractFactory("Go")
        const go = await Go.deploy(white.address, black.address)
        return { go, deployer, white, black, attacker }
    }

    describe("Initialization", function () {
        it("should assign correct player addresses", async function () {
            const { go, white, black } = await loadFixture(deployGoFixture)
            expect(await go.white()).to.equal(white.address)
            expect(await go.black()).to.equal(black.address)
        })

        it("should prevent unauthorized players from making moves", async function () {
            const { go, attacker } = await loadFixture(deployGoFixture)
            await expect(
                go.connect(attacker).play(0, 0)
            ).to.be.revertedWithCustomError(go, "CallerNotAllowedToPlay")
        })
    })

    describe("Basic Game Mechanics", function () {
        describe("Move Validation", function () {
            it("should enforce turn order", async function () {
                const { go, white } = await loadFixture(deployGoFixture)
                await expect(
                    go.connect(white).play(0, 0)
                ).to.be.revertedWithCustomError(go, "NotYourTurn")
            })

            it("should prevent playing on occupied intersections", async function () {
                const { go, black, white } = await loadFixture(deployGoFixture)
                await go.connect(black).play(0, 0)
                await expect(
                    go.connect(white).play(0, 0)
                ).to.be.revertedWithCustomError(go, "CannotPlayHere")
            })

            it("should prevent moves outside the board", async function () {
                const { go, black } = await loadFixture(deployGoFixture)
                await expect(
                    go.connect(black).play(19, 19)
                ).to.be.revertedWithCustomError(go, "OffBoard")
            })
        })

        describe("Board Navigation", function () {
            it("should calculate correct intersection IDs", async function () {
                const { go } = await loadFixture(deployGoFixture)
                expect(await go.getIntersectionId(16, 17)).to.equal(339)
                expect(await go.getIntersectionId(0, 0)).to.equal(0)
            })

            it("should identify off-board positions", async function () {
                const { go } = await loadFixture(deployGoFixture)
                expect(await go.isOffBoard(19, 19)).to.equal(true)
                expect(await go.isOffBoard(0, 0)).to.equal(false)
            })

            it("should correctly identify neighboring positions", async function () {
                const { go } = await loadFixture(deployGoFixture)
                const neighbors = await go.getNeighbors(
                    await go.getIntersectionId(1, 1)
                )
                expect(neighbors.east).to.equal(
                    await go.getIntersectionId(2, 1)
                )
                expect(neighbors.west).to.equal(
                    await go.getIntersectionId(0, 1)
                )
                expect(neighbors.north).to.equal(
                    await go.getIntersectionId(1, 2)
                )
                expect(neighbors.south).to.equal(
                    await go.getIntersectionId(1, 0)
                )
            })
        })
    })

    describe("Liberty Rules", function () {
        describe("Liberty Counting", function () {
            it("should count corner liberties correctly", async function () {
                const { go, black } = await loadFixture(deployGoFixture)
                await go.connect(black).play(0, 0)
                expect(
                    await go.countLiberties(await go.getIntersectionId(0, 0))
                ).to.equal(2)
            })

            it("should count edge liberties correctly", async function () {
                const { go, black } = await loadFixture(deployGoFixture)
                await go.connect(black).play(0, 1)
                expect(
                    await go.countLiberties(await go.getIntersectionId(0, 1))
                ).to.equal(3)
            })

            it("should count center liberties correctly", async function () {
                const { go, black } = await loadFixture(deployGoFixture)
                await go.connect(black).play(1, 1)
                expect(
                    await go.countLiberties(await go.getIntersectionId(1, 1))
                ).to.equal(4)
            })
        })

        describe("Suicide Prevention", function () {
            it("should prevent suicide moves", async function () {
                const { go, black, white } = await loadFixture(deployGoFixture)

                // Create surrounding pattern
                await go.connect(black).play(1, 0)
                await go.connect(white).play(0, 1)
                await go.connect(black).play(5, 5)
                await go.connect(white).play(1, 1)

                await expect(
                    go.connect(black).play(0, 0)
                ).to.be.revertedWithCustomError(go, "NoLiberties")
            })
        })

        describe("Capture Mechanics", function () {
            it("should properly execute captures", async function () {
                const { go, black, white } = await loadFixture(deployGoFixture)

                // Create a pattern to capture white stone
                await go.connect(black).play(1, 1) // Black places first stone
                await go.connect(white).play(2, 0) // White stone to be captured
                await go.connect(black).play(2, 1) // Black surrounds
                await go.connect(white).play(5, 5) // White plays elsewhere
                await go.connect(black).play(3, 0) // Black surrounds
                await go.connect(white).play(5, 6) // White plays elsewhere
                await go.connect(black).play(1, 0) // Black completes the capture

                // Verify capture
                expect(await go.capturedWhiteStones()).to.equal(1)

                // Verify position is empty
                const capturedPosition = await go.getIntersectionId(2, 0)
                const intersection = await go.intersections(capturedPosition)
                expect(intersection.state).to.equal(0)
            })
        })
    })

    describe("Group Mechanics", function () {
        it("should identify small connected groups", async function () {
            const { go, black, white } = await loadFixture(deployGoFixture)

            // Create 5-stone pattern
            await go.connect(black).play(16, 17)
            await go.connect(white).play(3, 3)
            await go.connect(black).play(16, 16)
            await go.connect(white).play(3, 16)
            await go.connect(black).play(16, 15)
            await go.connect(white).play(16, 3)
            await go.connect(black).play(17, 15)
            await go.connect(white).play(17, 5)
            await go.connect(black).play(15, 15)

            const startPos = await go.getIntersectionId(16, 17)
            const group = await go.getGroup(startPos)
            const nonZeroStones = Array.from(group)
                .map(n => Number(n))
                .filter(n => n !== 0)
                .sort((a, b) => a - b)

            expect(nonZeroStones.length).to.equal(5)
        })

        it("should identify large connected groups", async function () {
            const { go, black, white } = await loadFixture(deployGoFixture)

            const blackMoves = [
                [10, 10],
                [10, 11],
                [10, 12],
                [10, 13],
                [10, 14],
                [11, 14],
                [12, 14],
                [13, 14],
                [14, 14],
                [14, 13],
                [14, 12],
                [14, 11],
                [14, 10],
                [13, 10],
                [12, 10],
                [11, 10],
                [11, 11],
                [11, 12],
                [11, 13],
                [12, 13]
            ]

            const whiteMoves = [
                [5, 5],
                [5, 6],
                [5, 7],
                [5, 8],
                [5, 9],
                [6, 9],
                [7, 9],
                [8, 9],
                [9, 9],
                [9, 8],
                [9, 7],
                [9, 6],
                [9, 5],
                [8, 5],
                [7, 5],
                [6, 5],
                [6, 6],
                [6, 7],
                [6, 8],
                [7, 8]
            ]

            for (let i = 0; i < blackMoves.length - 1; i++) {
                await go.connect(black).play(blackMoves[i][0], blackMoves[i][1])
                await go.connect(white).play(whiteMoves[i][0], whiteMoves[i][1])
            }
            await go.connect(black).play(blackMoves[19][0], blackMoves[19][1])

            const startPos = await go.getIntersectionId(10, 10)
            const group = await go.getGroup(startPos)
            const nonZeroStones = group.filter(id => id.toString() !== "0")

            expect(nonZeroStones.length).to.equal(20)
        })
    })

    describe("Game Ending", function () {
        it("should handle passing correctly", async function () {
            const { go, black, white } = await loadFixture(deployGoFixture)

            await go.connect(black).pass()
            expect(await go.blackPassedOnce()).to.equal(true)
            expect(await go.whitePassedOnce()).to.equal(false)

            await go.connect(white).pass()
            expect(await go.whitePassedOnce()).to.equal(true)
            expect(await go.blackScore()).to.equal(1)
        })
    })
})
