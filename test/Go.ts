import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { expect } from "chai"
import { ethers } from "hardhat"

describe("Go", function () {
    async function startNewMatch() {
        const [deployer, white, black, attacker] = await ethers.getSigners()
        const Go = await ethers.getContractFactory("Go")
        const go = await Go.deploy(white.address, black.address)
        return { go, deployer, white, black, attacker }
    }

    describe("Deployment", function () {
        it("Should set the right players", async function () {
            const { go, white, black, attacker } = await loadFixture(
                startNewMatch
            )
            expect(await go.white()).to.equal(white.address)
            expect(await go.black()).to.equal(black.address)
            expect(go.connect(attacker).play(16, 17)).to.be.revertedWith(
                "CallerNotAllowedToPlay"
            )
        })
    })

    describe("Interactions", function () {
        it("Should play one move", async function () {
            const { go, white, black, attacker } = await loadFixture(
                startNewMatch
            )
            expect(go.connect(white).play(16, 17)).to.be.revertedWith(
                "NotYourTurn"
            )
            await go.connect(black).play(16, 17)
            expect(go.connect(white).play(16, 17)).to.be.revertedWith(
                "CannotPlayHere"
            )
            expect(go.connect(attacker).play(16, 17)).to.be.revertedWith(
                "CallerNotAllowedToPlay"
            )
        })

        it("Should return the intersection id", async function () {
            const { go, black } = await loadFixture(startNewMatch)
            await go.connect(black).play(16, 17)
            expect(await go.getIntersectionId(16, 17)).to.equal(339)
        })

        it("Should be off board", async function () {
            const { go, black, white } = await loadFixture(startNewMatch)
            await go.connect(black).play(16, 17)
            expect(await go.getIntersectionId(42, 42)).to.be.gt(360)
            expect(await go.isOffBoard(42, 42)).to.equal(true)
            expect(go.connect(white).play(1, 42)).to.be.revertedWith("OffBoard")
        })

        it("Should return the 4 neighbors", async function () {
            const { go, black } = await loadFixture(startNewMatch)
            await go.connect(black).play(16, 17)
            const target = await go.getIntersectionId(16, 17)
            expect((await go.getNeighbors(target)).east).to.equal(
                await go.getIntersectionId(17, 17)
            )
            expect((await go.getNeighbors(target)).west).to.equal(
                await go.getIntersectionId(15, 17)
            )
            expect((await go.getNeighbors(target)).north).to.equal(
                await go.getIntersectionId(16, 18)
            )
            expect((await go.getNeighbors(target)).south).to.equal(
                await go.getIntersectionId(16, 16)
            )
        })

        it("Should pass", async function () {
            const { go, black } = await loadFixture(startNewMatch)
            await go.connect(black).pass()
            expect(await go.blackPassedOnce()).to.equal(true)
        })

        it("Should end the game", async function () {
            const { go, black, white } = await loadFixture(startNewMatch)
            await go.connect(black).pass()
            await go.connect(white).play(16, 17)
            expect(go.connect(black).pass()).to.be.revertedWith(
                "MissingTwoConsecutivePass"
            )
            await go.connect(black).pass()
            await go.connect(white).pass()
            await go.connect(black).pass()
            expect(await go.blackScore()).to.equal(1)
        })

        it("Should return 5 connected stones", async function () {
            const { go, white, black } = await loadFixture(startNewMatch)

            await go.connect(black).play(16, 17) // center
            await go.connect(white).play(3, 3)
            await go.connect(black).play(16, 16) // south
            await go.connect(white).play(3, 16)
            await go.connect(black).play(16, 15) // south
            await go.connect(white).play(16, 3)
            await go.connect(black).play(17, 15) // east
            await go.connect(white).play(17, 5)
            await go.connect(black).play(15, 15) // west

            const getId = await go.getIntersectionId(16, 17)
            const getGroup = await go.getGroup(getId)

            // Convert to numbers and sort
            const nonZeroStones = Array.from(getGroup)
                .map(n => Number(n))
                .filter(n => n !== 0)
                .sort((a, b) => a - b)
                .join(",")

            expect(nonZeroStones + ",0".repeat(95)).to.equal(
                "300,301,302,320,339" + ",0".repeat(95)
            )
        })

        it("Should return 20 connected stones", async function () {
            const { go, white, black } = await loadFixture(startNewMatch)
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

            for (let i = 0; i < blackMoves.length; i++) {
                await go.connect(black).play(blackMoves[i][0], blackMoves[i][1])
                if (i < blackMoves.length - 1) {
                    await go
                        .connect(white)
                        .play(whiteMoves[i][0], whiteMoves[i][1])
                }
            }

            const getId = await go.getIntersectionId(10, 10)
            const getGroup = await go.getGroup(getId)
            const nonZeroStones = getGroup.filter(id => id.toString() !== "0")
            expect(nonZeroStones.length).to.equal(20)
        })
    })
})
