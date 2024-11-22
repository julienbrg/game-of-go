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

        describe("Group Identification", function () {
            it("should identify a group of stones in the center", async function () {
                const { go, black, white } = await loadFixture(deployGoFixture)

                // Create a cross-shaped group in the center
                await go.connect(black).play(9, 9) // Center stone
                await go.connect(white).play(0, 0) // White plays elsewhere
                await go.connect(black).play(9, 8) // North
                await go.connect(white).play(0, 1) // White plays elsewhere
                await go.connect(black).play(9, 10) // South
                await go.connect(white).play(0, 2) // White plays elsewhere
                await go.connect(black).play(8, 9) // West
                await go.connect(white).play(0, 3) // White plays elsewhere
                await go.connect(black).play(10, 9) // East

                const centerPos = await go.getIntersectionId(9, 9)
                const group = await go.getGroup(centerPos)

                // Filter out zero values and convert to numbers
                const stones = group
                    .map(id => Number(id))
                    .filter(id => id !== 0)

                // Should find exactly 5 stones in the group
                expect(stones.length).to.equal(5)

                // Verify specific positions are in the group
                const expectedPositions = [
                    await go.getIntersectionId(9, 9), // Center
                    await go.getIntersectionId(9, 8), // North
                    await go.getIntersectionId(9, 10), // South
                    await go.getIntersectionId(8, 9), // West
                    await go.getIntersectionId(10, 9) // East
                ].map(id => Number(id))

                // Check that all expected positions are present
                expectedPositions.forEach(pos => {
                    expect(stones).to.include(pos)
                })
            })

            it("should identify a group of stones in the corner", async function () {
                const { go, black, white } = await loadFixture(deployGoFixture)

                console.log("\nStep 1: Creating test board")

                // Place stones to form a group in the top-right corner (using valid coordinates 17,18)
                // 0,0,0,B,B  (17,0) (18,0)
                // 0,0,0,B,0  (17,1)
                // 0,0,0,0,0

                // First stone
                await go.connect(black).play(17, 0)
                console.log("Black played at (17,0)")
                let cornerGroup = await go.getGroup(
                    await go.getIntersectionId(17, 0)
                )
                console.log("Checking corner position after first stone:")
                console.log(
                    "Corner group stones:",
                    cornerGroup.map(pos => pos.toString())
                )

                // Need white to play in between black moves
                await go.connect(white).play(0, 0)
                console.log("White played at (0,0)")

                // Second stone
                await go.connect(black).play(18, 0)
                console.log("Black played at (18,0)")
                cornerGroup = await go.getGroup(
                    await go.getIntersectionId(17, 0)
                )
                console.log("Checking corner group after second stone:")
                console.log(
                    "Corner group stones:",
                    cornerGroup.map(pos => pos.toString())
                )

                await go.connect(white).play(0, 1)
                console.log("White played at (0,1)")

                // Third stone
                await go.connect(black).play(17, 1)
                console.log("Black played at (17,1)")

                // Get the final group starting from the corner stone
                cornerGroup = await go.getGroup(
                    await go.getIntersectionId(17, 0)
                )
                console.log("\nFinal corner group check:")
                console.log(
                    "Corner group stones:",
                    cornerGroup.map(pos => pos.toString())
                )

                // Filter out empty (zero) positions from the returned array
                const activePositions = cornerGroup.filter(
                    pos => pos.toString() !== "0"
                )

                // Print the actual positions for debugging
                console.log(
                    "\nActive positions:",
                    activePositions.map(pos => pos.toString())
                )

                // We expect 3 stones in the group
                expect(activePositions.length).to.equal(3)

                // Verify each expected position is in the group
                const expectedPositions = [
                    await go.getIntersectionId(17, 0),
                    await go.getIntersectionId(18, 0),
                    await go.getIntersectionId(17, 1)
                ]

                console.log(
                    "Expected positions:",
                    expectedPositions.map(pos => pos.toString())
                )

                for (const pos of expectedPositions) {
                    expect(activePositions).to.include(pos)
                }

                // Verify the state of the stones
                for (const pos of activePositions) {
                    const intersection = await go.intersections(pos)
                    console.log(
                        `Stone at position ${pos} state:`,
                        intersection.state
                    )
                    expect(intersection.state).to.equal(1) // 1 represents Black in the State enum
                }

                // Print the liberties of the group
                for (const pos of activePositions) {
                    const liberties = await go.countLiberties(pos)
                    console.log(
                        `Liberties for stone at position ${pos}:`,
                        liberties
                    )
                }
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
            describe("Single Stone Captures", function () {
                it("should properly execute single stone captures", async function () {
                    const { go, black, white } = await loadFixture(
                        deployGoFixture
                    )

                    await go.connect(black).play(1, 1) // Black places first stone
                    await go.connect(white).play(2, 0) // White stone to be captured
                    await go.connect(black).play(2, 1) // Black surrounds
                    await go.connect(white).play(5, 5) // White elsewhere
                    await go.connect(black).play(3, 0) // Black surrounds
                    await go.connect(white).play(5, 6) // White elsewhere
                    await go.connect(black).play(1, 0) // Black completes capture

                    expect(await go.capturedWhiteStones()).to.equal(1)

                    const capturedPosition = await go.getIntersectionId(2, 0)
                    const intersection = await go.intersections(
                        capturedPosition
                    )
                    expect(intersection.state).to.equal(0)
                })
            })

            describe("Group Captures", function () {
                it("should capture two stones in the center", async function () {
                    const { go, black, white } = await loadFixture(
                        deployGoFixture
                    )

                    // Place two white stones in center
                    await go.connect(black).play(0, 0) // Black elsewhere
                    await go.connect(white).play(10, 10) // White first stone
                    await go.connect(black).play(0, 1) // Black elsewhere
                    await go.connect(white).play(10, 11) // White second stone

                    // Surround the stones
                    await go.connect(black).play(9, 10) // Left
                    await go.connect(white).play(0, 2) // White elsewhere
                    await go.connect(black).play(9, 11) // Left
                    await go.connect(white).play(0, 3) // White elsewhere
                    await go.connect(black).play(11, 10) // Right
                    await go.connect(white).play(0, 4) // White elsewhere
                    await go.connect(black).play(11, 11) // Right
                    await go.connect(white).play(0, 5) // White elsewhere
                    await go.connect(black).play(10, 9) // Top
                    await go.connect(white).play(0, 6) // White elsewhere
                    await go.connect(black).play(10, 12) // Bottom completes capture

                    expect(await go.capturedWhiteStones()).to.equal(2)

                    // Verify positions are empty
                    const pos1 = await go.getIntersectionId(10, 10)
                    const pos2 = await go.getIntersectionId(10, 11)
                    expect((await go.intersections(pos1)).state).to.equal(0)
                    expect((await go.intersections(pos2)).state).to.equal(0)
                })

                it("should capture two stones on the edge", async function () {
                    const { go, black, white } = await loadFixture(
                        deployGoFixture
                    )

                    // Place two white stones on edge
                    await go.connect(black).play(5, 5) // Black elsewhere
                    await go.connect(white).play(0, 10) // White first stone
                    await go.connect(black).play(5, 6) // Black elsewhere
                    await go.connect(white).play(0, 11) // White second stone

                    // Surround the stones
                    await go.connect(black).play(1, 10) // Right
                    await go.connect(white).play(5, 7) // White elsewhere
                    await go.connect(black).play(1, 11) // Right
                    await go.connect(white).play(5, 8) // White elsewhere
                    await go.connect(black).play(0, 9) // Top
                    await go.connect(white).play(5, 9) // White elsewhere
                    await go.connect(black).play(0, 12) // Bottom completes capture

                    expect(await go.capturedWhiteStones()).to.equal(2)

                    // Verify positions are empty
                    const pos1 = await go.getIntersectionId(0, 10)
                    const pos2 = await go.getIntersectionId(0, 11)
                    expect((await go.intersections(pos1)).state).to.equal(0)
                    expect((await go.intersections(pos2)).state).to.equal(0)
                })

                it("should capture two stones in the corner", async function () {
                    const { go, black, white } = await loadFixture(
                        deployGoFixture
                    )

                    console.log("\nStep 1: Creating test board")

                    // First turn - Black starts
                    await go.connect(black).play(5, 5)
                    console.log("Black played at (5,5)")

                    // White places first corner stone
                    await go.connect(white).play(0, 0)
                    console.log("White played at (0,0)")

                    // Debug corner stone
                    const cornerPos = await go.getIntersectionId(0, 0)
                    console.log("\nChecking corner position after placement:")
                    const cornerGroup1 = await go.getGroup(cornerPos)
                    console.log(
                        "Corner group stones:",
                        cornerGroup1.map(x => x.toString())
                    )

                    // Black plays elsewhere
                    await go.connect(black).play(5, 6)
                    console.log("Black played at (5,6)")

                    // White places second stone
                    await go.connect(white).play(0, 1)
                    console.log("White played at (0,1)")

                    // Debug connected stones
                    console.log("\nChecking corner group after second stone:")
                    const cornerGroup2 = await go.getGroup(cornerPos)
                    console.log(
                        "Corner group stones:",
                        cornerGroup2.map(x => x.toString())
                    )

                    // Place capturing black stones
                    await go.connect(black).play(1, 0)
                    console.log("Black played at (1,0)")

                    // Print board state
                    console.log("\nBoard state after first capturing move:")
                    for (let y = 0; y < 3; y++) {
                        let row = ""
                        for (let x = 0; x < 3; x++) {
                            const pos = await go.getIntersectionId(x, y)
                            const state = (await go.intersections(pos)).state
                            row += state.toString() + " "
                        }
                        console.log(row)
                    }

                    await go.connect(white).play(5, 7)
                    console.log("White played at (5,7)")

                    await go.connect(black).play(1, 1)
                    console.log("Black played at (1,1)")

                    // Print board state
                    console.log("\nBoard state after second capturing move:")
                    for (let y = 0; y < 3; y++) {
                        let row = ""
                        for (let x = 0; x < 3; x++) {
                            const pos = await go.getIntersectionId(x, y)
                            const state = (await go.intersections(pos)).state
                            row += state.toString() + " "
                        }
                        console.log(row)
                    }

                    await go.connect(white).play(5, 8)
                    console.log("White played at (5,8)")

                    await go.connect(black).play(0, 2)
                    console.log("Black played final capturing move at (0,2)")

                    // Check group one last time before capture
                    console.log("\nChecking corner group before final capture:")
                    const cornerGroup3 = await go.getGroup(cornerPos)
                    console.log(
                        "Corner group stones:",
                        cornerGroup3.map(x => x.toString())
                    )

                    // Count liberties
                    const liberties = await go.countLiberties(cornerPos)
                    console.log("Corner liberties:", liberties)

                    // Check captures
                    const capturedWhite = await go.capturedWhiteStones()
                    console.log(
                        "\nCaptured white stones:",
                        capturedWhite.toString()
                    )

                    // Print final board state
                    console.log("\nFinal board state:")
                    for (let y = 0; y < 3; y++) {
                        let row = ""
                        for (let x = 0; x < 3; x++) {
                            const pos = await go.getIntersectionId(x, y)
                            const state = (await go.intersections(pos)).state
                            row += state.toString() + " "
                        }
                        console.log(row)
                    }

                    expect(await go.capturedWhiteStones()).to.equal(2)

                    // Verify positions are empty
                    const cornerState = (await go.intersections(cornerPos))
                        .state
                    const belowPos = await go.getIntersectionId(0, 1)
                    const belowState = (await go.intersections(belowPos)).state

                    expect(cornerState).to.equal(0)
                    expect(belowState).to.equal(0)
                })
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

    describe("Game State", function () {})
})
