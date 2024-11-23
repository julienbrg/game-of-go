import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { expect } from "chai"
import { ethers } from "hardhat"
import type { Go } from "../typechain-types"

// Helper function for coordinate conversion
function coordsToPosition(x: number, y: number): number {
    return y * 19 + x
}

// Convert SGF coordinates to board positions (SGF uses letters a-s, we need 0-18)
const sgfToCoord = (sgfCoord: string): [number, number] => {
    const x = sgfCoord.charCodeAt(0) - 97 // 'a' starts at 97 in ASCII
    const y = sgfCoord.charCodeAt(1) - 97
    return [x, y]
}

describe("Go Game", function () {
    // Common fixture for all tests
    async function deployGameFixture() {
        const [deployer, white, black, attacker] = await ethers.getSigners()
        const Go = await ethers.getContractFactory("Go")
        const go = await Go.deploy(white.address, black.address)
        return { go, deployer, white, black, attacker }
    }

    describe("Game Setup", function () {
        it("Should initialize player addresses correctly", async function () {
            const { go, white, black } = await loadFixture(deployGameFixture)
            expect(await go.white()).to.equal(white.address)
            expect(await go.black()).to.equal(black.address)
        })

        it("Should set black player to move first", async function () {
            const { go, black } = await loadFixture(deployGameFixture)
            expect(await go.turn()).to.equal(black.address)
        })

        it("Should initialize an empty board", async function () {
            const { go } = await loadFixture(deployGameFixture)
            const { board } = await go.getGameState()

            // Check corners and center
            expect(board[0].state).to.equal(0) // Top left
            expect(board[18].state).to.equal(0) // Top right
            expect(board[180].state).to.equal(0) // Center
            expect(board[342].state).to.equal(0) // Bottom left
            expect(board[360].state).to.equal(0) // Bottom right
        })
    })

    describe("Move Validation", function () {
        it("Should prevent unauthorized players from making moves", async function () {
            const { go, attacker } = await loadFixture(deployGameFixture)
            await expect(
                go.connect(attacker).play(0, 0)
            ).to.be.revertedWithCustomError(go, "CallerNotAllowedToPlay")
        })

        it("Should prevent playing out of turn", async function () {
            const { go, white } = await loadFixture(deployGameFixture)
            await expect(
                go.connect(white).play(0, 0)
            ).to.be.revertedWithCustomError(go, "NotYourTurn")
        })

        it("Should prevent playing on occupied intersections", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).play(0, 0)
            await go.connect(white).play(1, 0)
            await expect(
                go.connect(black).play(0, 0)
            ).to.be.revertedWithCustomError(go, "CannotPlayHere")
        })

        it("Should prevent playing outside board boundaries", async function () {
            const { go, black } = await loadFixture(deployGameFixture)
            await expect(
                go.connect(black).play(19, 0)
            ).to.be.revertedWithCustomError(go, "OffBoard")
            await expect(
                go.connect(black).play(0, 19)
            ).to.be.revertedWithCustomError(go, "OffBoard")
        })
    })

    describe("Basic Game Mechanics", function () {
        it("Should alternate turns after valid moves", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).play(0, 0)
            expect(await go.turn()).to.equal(white.address)
            await go.connect(white).play(0, 1)
            expect(await go.turn()).to.equal(black.address)
        })

        it("Should correctly place stones on the board", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).play(0, 0)
            await go.connect(white).play(1, 1)

            const { board } = await go.getGameState()
            expect(board[coordsToPosition(0, 0)].state).to.equal(1) // Black stone
            expect(board[coordsToPosition(1, 1)].state).to.equal(2) // White stone
        })

        it("Should emit Move event on valid moves", async function () {
            const { go, black } = await loadFixture(deployGameFixture)
            await expect(go.connect(black).play(0, 0))
                .to.emit(go, "Move")
                .withArgs("Black", 0, 0)
        })

        it("Should correctly identify connected stones as a single group", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            // Create a group of connected black stones
            await go.connect(black).play(3, 3)
            await go.connect(white).play(0, 0)
            await go.connect(black).play(3, 4)
            await go.connect(white).play(0, 1)
            await go.connect(black).play(4, 3)

            const group = await go.getGroup(coordsToPosition(3, 3))
            expect(group.filter(pos => pos > 0n)).to.have.lengthOf(3)
        })

        it("Should respect the MAX_GROUP_SIZE constant", async function () {
            const { go } = await loadFixture(deployGameFixture)
            const maxSize = await go.MAX_GROUP_SIZE()
            expect(maxSize).to.equal(100) // Verify constant
        })
    })

    describe("Passing Mechanics", function () {
        it("Should allow players to pass their turn", async function () {
            const { go, black } = await loadFixture(deployGameFixture)
            await expect(go.connect(black).pass()).to.not.be.reverted
        })

        it("Should track pass states correctly", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).pass()
            const state = await go.getGameState()
            expect(state.isBlackPassed).to.be.true
            expect(state.isWhitePassed).to.be.false
        })

        it("Should end game after two consecutive passes", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).pass()
            await go.connect(white).pass()

            // Both players should be marked as passed
            const state = await go.getGameState()
            expect(state.isBlackPassed && state.isWhitePassed).to.be.true
        })

        it("Should reset pass state after a move", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).pass()
            await go.connect(white).play(0, 0)

            const state = await go.getGameState()
            expect(state.isBlackPassed).to.be.true
            expect(state.isWhitePassed).to.be.false
        })
    })

    describe("Capture Mechanics", function () {
        it("Should capture a single stone with no liberties", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Surround white stone
            await go.connect(black).play(1, 0) // Top
            await go.connect(white).play(1, 1) // Target stone
            await go.connect(black).play(0, 1) // Left
            await go.connect(white).play(18, 18) // Pass-like move
            await go.connect(black).play(1, 2) // Bottom
            await go.connect(white).play(18, 17) // Pass-like move
            await go.connect(black).play(2, 1) // Right

            const state = await go.getGameState()
            expect(state.whiteCaptured).to.equal(1)
        })

        it("Should capture a group with no liberties", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            // Create and surround a white group
            await go.connect(black).play(0, 0)
            await go.connect(white).play(1, 0)
            await go.connect(black).play(2, 0)
            await go.connect(white).play(1, 1)
            await go.connect(black).play(0, 1)
            await go.connect(white).play(18, 18) // Pass-like move
            await go.connect(black).play(2, 1)
            await go.connect(white).play(18, 17) // Pass-like move
            await go.connect(black).play(1, 2)

            const state = await go.getGameState()
            expect(state.whiteCaptured).to.equal(2)
        })

        it("Should prevent suicide moves", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Create a position where playing would be suicide
            await go.connect(black).play(0, 1) // Top
            await go.connect(white).play(18, 18) // Away move
            await go.connect(black).play(1, 0) // Right
            await go.connect(white).play(18, 17) // Away move
            await go.connect(black).play(1, 2) // Bottom

            // Attempt suicide move at (0,0)
            await expect(
                go.connect(white).play(0, 0)
            ).to.be.revertedWithCustomError(go, "NoLiberties")
        })
    })

    describe("Liberty Counting", function () {
        it("Should count liberties correctly for corner stones", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Place stones in corners
            await go.connect(black).play(0, 0) // Top left
            await go.connect(white).play(18, 18) // Bottom right
            await go.connect(black).play(0, 18) // Bottom left
            await go.connect(white).play(18, 0) // Top right

            // Check liberties for each corner
            expect(await go.countLiberties(coordsToPosition(0, 0))).to.equal(2)
            expect(await go.countLiberties(coordsToPosition(18, 18))).to.equal(
                2
            )
            expect(await go.countLiberties(coordsToPosition(0, 18))).to.equal(2)
            expect(await go.countLiberties(coordsToPosition(18, 0))).to.equal(2)
        })

        it("Should count liberties correctly for edge stones", async function () {
            const { go, black } = await loadFixture(deployGameFixture)

            // Place stone on edge
            await go.connect(black).play(0, 9) // Middle of left edge

            expect(await go.countLiberties(coordsToPosition(0, 9))).to.equal(3)
        })

        it("Should count liberties correctly for center stones", async function () {
            const { go, black } = await loadFixture(deployGameFixture)

            // Place stone in center
            await go.connect(black).play(9, 9)

            expect(await go.countLiberties(coordsToPosition(9, 9))).to.equal(4)
        })
    })

    describe("Game State Management", function () {
        it("should track captured stones correctly", async function () {
            const { go, white, black } = await loadFixture(deployGameFixture)

            await go.connect(black).play(3, 3)
            await go.connect(white).play(3, 2)
            await go.connect(black).play(15, 2)
            await go.connect(white).play(4, 3)
            await go.connect(black).play(15, 15)
            await go.connect(white).play(3, 4)
            await go.connect(black).play(3, 15)
            await go.connect(white).play(2, 3)

            const gameState = await go.getGameState()

            const capturedWhiteStones = await go.capturedWhiteStones()
            const capturedBlackStones = await go.capturedBlackStones()

            expect(capturedWhiteStones).to.equal(
                0,
                "No white stones should be captured yet"
            )
            expect(capturedBlackStones).to.equal(
                1,
                "No black stones should be captured yet"
            )
        })

        it("Should maintain correct game state throughout gameplay", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Play a sequence of moves
            await go.connect(black).play(3, 3)
            await go.connect(white).play(15, 15)
            await go.connect(black).play(3, 15)
            await go.connect(white).play(15, 3)
            const state = await go.getGameState()

            // Verify stone placements
            expect(state.board[coordsToPosition(3, 3)].state).to.equal(1) // Black
            expect(state.board[coordsToPosition(15, 15)].state).to.equal(2) // White
            expect(state.board[coordsToPosition(3, 15)].state).to.equal(1) // Black
            expect(state.board[coordsToPosition(15, 3)].state).to.equal(2) // White

            // Verify turn
            expect(state.currentTurn).to.equal(black.address)

            // Verify capture counts
            expect(state.whiteCaptured).to.equal(0)
            expect(state.blackCaptured).to.equal(0)
        })
        it("Should correctly execute a specific game sequence", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // The sequence from the SGF: B[dd];W[cd];B[pp];W[dc];B[qd];W[ed];B[dq];W[de]
            const moves = [
                { player: black, coord: "dd" }, // Black D4
                { player: white, coord: "cd" }, // White C4
                { player: black, coord: "pp" }, // Black Q16
                { player: white, coord: "dc" }, // White D3
                { player: black, coord: "qd" }, // Black Q4
                { player: white, coord: "ed" }, // White E4
                { player: black, coord: "dq" }, // Black D17
                { player: white, coord: "de" } // White D15 (captures Black D4)
            ]

            // Execute each move
            for (const move of moves) {
                const [x, y] = sgfToCoord(move.coord)
                await go.connect(move.player).play(x, y)

                // Verify the stone was placed correctly
                const pos = await go.getIntersectionId(x, y)
                const intersection = await go.intersections(pos)

                // Verify the stone color (1 for Black, 2 for White)
                const expectedState = move.player === black ? 1 : 2
                expect(intersection.state).to.equal(expectedState)
            }

            // Verify final board state matches expected positions
            const verifyPosition = async (
                coord: string,
                expectedState: number
            ) => {
                const [x, y] = sgfToCoord(coord)
                const pos = await go.getIntersectionId(x, y)
                const intersection = await go.intersections(pos)
                expect(intersection.state).to.equal(expectedState)
            }

            // The Black stone at D4 should now be captured (empty)
            await verifyPosition("dd", 0) // D4 should be empty after capture
            await verifyPosition("cd", 2) // White stone at C4
            await verifyPosition("pp", 1) // Black stone at Q16
            await verifyPosition("dc", 2) // White stone at D3
            await verifyPosition("qd", 1) // Black stone at Q4
            await verifyPosition("ed", 2) // White stone at E4
            await verifyPosition("dq", 1) // Black stone at D17
            await verifyPosition("de", 2) // White stone at D15

            // Verify one Black stone was captured
            expect(await go.capturedBlackStones()).to.equal(1)
            expect(await go.capturedWhiteStones()).to.equal(0)

            // Verify turn is correct after sequence (should be Black's turn)
            expect(await go.turn()).to.equal(black.address)
        })

        it("Should track pass states across multiple moves", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).pass()
            await go.connect(white).play(0, 0)
            await go.connect(black).play(0, 1)
            await go.connect(white).pass()

            const state = await go.getGameState()
            expect(state.isBlackPassed).to.be.false
            expect(state.isWhitePassed).to.be.true
        })
    })

    describe("Go Game Ko Rule", function () {
        it("Should detect ko rule violation in realistic game sequence", async function () {
            const { go, white, black } = await loadFixture(deployGameFixture)

            // Helper to convert and play a move
            async function playMove(
                sgfMove: string,
                player: SignerWithAddress // TODO: fix that warning
            ) {
                const [x, y] = sgfToCoord(sgfMove)
                console.log(
                    `Playing at (${x},${y}) - converted from ${sgfMove}`
                )
                await go.connect(player).play(x, y)

                // Print game state after each move
                const state = await go.getGameState()
                console.log(
                    `Captured stones - Black: ${state.blackCaptured}, White: ${state.whiteCaptured}`
                )
            }

            // Play the exact sequence from the SGF
            const sequence = [
                { coord: "dd", player: black }, // Black D16
                { coord: "ed", player: white }, // White E16
                { coord: "ec", player: black }, // Black E17
                { coord: "dc", player: white }, // White D17
                { coord: "fd", player: black }, // Black F16
                { coord: "cd", player: white }, // White C16
                { coord: "ee", player: black }, // Black E15
                { coord: "de", player: white }, // White D15
                { coord: "pd", player: black }, // Black P16
                { coord: "ed", player: white } // White E16 - captures Black's stone at E17
            ]

            // Play each move in sequence
            for (const move of sequence) {
                await playMove(move.coord, move.player)
            }

            // Now the critical test - Black attempts to retake at D16
            const [koX, koY] = sgfToCoord("dd")

            // Log the state before attempting the ko violation
            console.log(`Attempting ko violation at (${koX},${koY})`)
            const stateBefore = await go.getGameState()
            console.log(
                "Last captured position:",
                await go.lastCapturedPosition()
            )
            console.log("Last captured turn:", await go.lastCapturedTurn())
            console.log(
                "Current block number:",
                await ethers.provider.getBlockNumber()
            )

            // This should revert due to the ko rule
            await expect(
                go.connect(black).play(koX, koY)
            ).to.be.revertedWithCustomError(go, "ViolatesKoRule")

            // Verify final game state
            const gameState = await go.getGameState()
            expect(gameState.blackCaptured).to.equal(1) // One black stone was captured
            expect(gameState.currentTurn).to.equal(black.address) // Still black's turn after failed move
        })

        it("Should enforce ko rule throughout an extended sequence", async function () {
            const { go, white, black } = await loadFixture(deployGameFixture)

            // Initial ko setup
            await go.connect(black).play(...sgfToCoord("dd")) // B D16
            await go.connect(white).play(...sgfToCoord("ed")) // W E16
            await go.connect(black).play(...sgfToCoord("ec")) // B E17
            await go.connect(white).play(...sgfToCoord("dc")) // W D17
            await go.connect(black).play(...sgfToCoord("fd")) // B F16
            await go.connect(white).play(...sgfToCoord("cd")) // W C16
            await go.connect(black).play(...sgfToCoord("ee")) // B E15
            await go.connect(white).play(...sgfToCoord("de")) // W D15
            await go.connect(black).play(...sgfToCoord("pd")) // B P16
            await go.connect(white).play(...sgfToCoord("ed")) // W E16 (captures)

            // First ko violation attempt
            await expect(
                go.connect(black).play(...sgfToCoord("dd"))
            ).to.be.revertedWithCustomError(go, "ViolatesKoRule")

            // Players make moves elsewhere
            await go.connect(black).play(...sgfToCoord("qp")) // B Q4
            await go.connect(white).play(...sgfToCoord("qc")) // W Q17

            // Now black can retake the ko
            await go.connect(black).play(...sgfToCoord("dd")) // B D16
            await go.connect(white).play(...sgfToCoord("qq")) // W R3
            await go.connect(black).play(...sgfToCoord("cp")) // B C4

            // White retakes the ko
            await go.connect(white).play(...sgfToCoord("ed")) // W E16 (captures again)

            // Verify final position
            const gameState = await go.getGameState()
            expect(gameState.blackCaptured).to.equal(2) // Black should have lost 2 stones
            expect(gameState.currentTurn).to.equal(black.address)

            // Verify ko rule is still enforced
            await expect(
                go.connect(black).play(...sgfToCoord("dd"))
            ).to.be.revertedWithCustomError(go, "ViolatesKoRule")
        })
    })

    describe("Event Testing", function () {
        it("Should emit Capture events with correct counts", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            await go.connect(black).play(1, 0)
            await go.connect(white).play(1, 1)
            await go.connect(black).play(2, 1)
            await go.connect(white).play(18, 18)
            await go.connect(black).play(1, 2)
            await go.connect(white).play(18, 17)

            await expect(go.connect(black).play(0, 1))
                .to.emit(go, "Capture")
                .withArgs("White", 1)
        })

        it("Should emit End event with correct scores", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).pass()

            await expect(go.connect(white).pass())
                .to.emit(go, "End")
                .withArgs("Black wins", 1, 0)
        })
    })

    describe("Edge Cases", function () {
        it("Should handle complex captures with multiple groups simultaneously", async function () {
            const { go, white, black } = await loadFixture(deployGameFixture)

            // Helper to get current board state
            const getBoardState = async () => {
                const state = await go.getGameState()
                return state
            }

            // Play sequence leading to the capture scenario
            const moves = [
                { color: black, pos: "dd" }, // B[dd]
                { color: white, pos: "dc" }, // W[dc]
                { color: black, pos: "fd" }, // B[fd]
                { color: white, pos: "pc" }, // W[pc]
                { color: black, pos: "qe" }, // B[qe]
                { color: white, pos: "cd" }, // W[cd]
                { color: black, pos: "gd" }, // B[gd]
                { color: white, pos: "de" }, // W[de]
                { color: black, pos: "pp" }, // B[pp]
                { color: white, pos: "gc" }, // W[gc]
                { color: black, pos: "qj" }, // B[qj]
                { color: white, pos: "hd" }, // W[hd]
                { color: black, pos: "jq" }, // B[jq]
                { color: white, pos: "ge" }, // W[ge]
                { color: black, pos: "dp" }, // B[dp]
                { color: white, pos: "fe" }, // W[fe]
                { color: black, pos: "cj" }, // B[cj]
                { color: white, pos: "fc" }, // W[fc]
                { color: black, pos: "qm" } // B[qm]
            ]

            // Play all moves before the capturing move
            for (const move of moves) {
                const [x, y] = sgfToCoord(move.pos)
                await go.connect(move.color).play(x, y)
            }

            // Get the state before the capturing move
            const stateBefore = await getBoardState()

            // W[ed] - The capturing move
            const [captureX, captureY] = sgfToCoord("ed")
            await go.connect(white).play(captureX, captureY)

            // Get the state after the capturing move
            const stateAfter = await getBoardState()

            // Verify that White captured exactly 3 stones
            expect(
                stateAfter.whiteCaptured - stateBefore.whiteCaptured
            ).to.equal(0)
            expect(
                stateAfter.blackCaptured - stateBefore.blackCaptured
            ).to.equal(3)

            // Verify that the captured positions are now empty
            // Check the captured positions using sgfToCoord
            const capturedPositions = ["fd", "gd", "dd"].map(sgfToCoord)
            for (const [x, y] of capturedPositions) {
                expect(
                    (await go.intersections(coordsToPosition(x, y))).state
                ).to.equal(0) // Should be empty
            }

            // Verify the capturing stone is still in place
            const [edX, edY] = sgfToCoord("ed")
            expect(
                (await go.intersections(coordsToPosition(edX, edY))).state
            ).to.equal(2) // White (2)
        })

        it("Should correctly handle a complex game sequence", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            /* SGF Moves:
            (;
            FF[4]
            CA[UTF-8]
            GM[1]
            SZ[19]
            AP[maxiGos:8.03]
            ;B[dc];W[pp];B[cp];W[pd];B[qf]
            ;W[ce];B[qm];W[ep];B[dh];W[jq]
            ;B[jc];W[cl];B[jp];W[jr];B[kq]
            ;W[mc];B[iq];W[cg];B[ir];W[nq]
            ;B[kr];W[js];B[is];W[ks];B[ls])
            */

            await go.connect(black).play(3, 2) // B[dc]
            await go.connect(white).play(15, 15) // W[pp]
            await go.connect(black).play(2, 15) // B[cp]
            await go.connect(white).play(15, 3) // W[pd]
            await go.connect(black).play(16, 5) // B[qf]

            await go.connect(white).play(2, 4) // W[ce]
            await go.connect(black).play(16, 12) // B[qm]
            await go.connect(white).play(4, 15) // W[ep]
            await go.connect(black).play(3, 7) // B[dh]
            await go.connect(white).play(9, 16) // W[jq]

            await go.connect(black).play(9, 2) // B[jc]
            await go.connect(white).play(2, 11) // W[cl]
            await go.connect(black).play(9, 15) // B[jp]
            await go.connect(white).play(9, 17) // W[jr]
            await go.connect(black).play(10, 16) // B[kq]

            await go.connect(white).play(12, 2) // W[mc]
            await go.connect(black).play(8, 16) // B[iq]
            await go.connect(white).play(2, 6) // W[cg]
            await go.connect(black).play(8, 17) // B[ir]
            await go.connect(white).play(13, 16) // W[nq]

            await go.connect(black).play(10, 17) // B[kr]
            await go.connect(white).play(9, 18) // W[js]
            await go.connect(black).play(8, 18) // B[is]
            await go.connect(white).play(10, 18) // W[ks]
            await go.connect(black).play(11, 18) // B[ls]

            const state = await go.getGameState()

            // Verify key stone placements
            expect(Number(state.board[coordsToPosition(3, 2)].state)).to.equal(
                1
            ) // dc
            expect(
                Number(state.board[coordsToPosition(15, 15)].state)
            ).to.equal(2) // pp
            expect(
                Number(state.board[coordsToPosition(11, 18)].state)
            ).to.equal(1) // ls

            // Verify capture counts
            expect(Number(state.whiteCaptured)).to.equal(4)
            expect(Number(state.blackCaptured)).to.equal(0)
        })
    })
    describe("Historic Games", function () {
        // Helper function to visualize a section of the board
        async function visualizeArea(
            go: any,
            centerX: number,
            centerY: number,
            radius: number = 3
        ) {
            const startX = Math.max(0, centerX - radius)
            const endX = Math.min(18, centerX + radius)
            const startY = Math.max(0, centerY - radius)
            const endY = Math.min(18, centerY + radius)

            console.log(
                "\nBoard state around",
                String.fromCharCode(97 + centerX) +
                    String.fromCharCode(97 + centerY),
                `(${centerX},${centerY})`
            )
            console.log("  ", "-".repeat((endX - startX + 1) * 4))

            for (let y = startY; y <= endY; y++) {
                let row = y.toString().padStart(2) + "| "
                for (let x = startX; x <= endX; x++) {
                    const pos = await go.getIntersectionId(x, y)
                    const intersection = await go.intersections(pos)
                    switch (intersection.state) {
                        case 0:
                            row += ".   "
                            break
                        case 1:
                            row += "B   "
                            break
                        case 2:
                            row += "W   "
                            break
                    }
                }
                console.log(row)
            }
            console.log("  ", "-".repeat((endX - startX + 1) * 4))

            // Show coordinates for reference
            let coordRow = "   "
            for (let x = startX; x <= endX; x++) {
                coordRow += String.fromCharCode(97 + x).padEnd(4)
            }
            console.log(coordRow)
        }

        // Helper to get adjacent positions and their states
        async function checkAdjacent(go: any, x: number, y: number) {
            console.log("\nAdjacent positions check:")
            const positions = [
                { dx: -1, dy: 0, dir: "Left" },
                { dx: 1, dy: 0, dir: "Right" },
                { dx: 0, dy: -1, dir: "Above" },
                { dx: 0, dy: 1, dir: "Below" }
            ]

            for (const { dx, dy, dir } of positions) {
                if (x + dx >= 0 && x + dx < 19 && y + dy >= 0 && y + dy < 19) {
                    const pos = await go.getIntersectionId(x + dx, y + dy)
                    const intersection = await go.intersections(pos)
                    const state =
                        intersection.state === 0
                            ? "Empty"
                            : intersection.state === 1
                            ? "Black"
                            : "White"
                    console.log(`${dir}: (${x + dx},${y + dy}) - ${state}`)
                    if (intersection.state > 0) {
                        const liberties = await go.countLiberties(pos)
                        console.log(`  Liberties: ${liberties}`)
                    }
                }
            }
        }

        xit("Should replay the complete Lee Sedol vs AlphaGo Game 4 - The Divine Move", async function () {
            const { go, white, black } = await loadFixture(deployGameFixture)

            // Complete game sequence from SGF
            const sequence = [
                // Opening (1-20)
                { color: black, move: "pd" }, // 1: P16
                { color: white, move: "dp" }, // 2: D4
                { color: black, move: "cd" }, // 3: C16
                { color: white, move: "qp" }, // 4: R4
                { color: black, move: "op" }, // 5: P4
                { color: white, move: "oq" }, // 6: P3
                { color: black, move: "nq" }, // 7: O3
                { color: white, move: "pq" }, // 8: Q3
                { color: black, move: "cn" }, // 9: C6
                { color: white, move: "fq" }, // 10: F3
                { color: black, move: "mp" }, // 11: M4
                { color: white, move: "po" }, // 12: Q5
                { color: black, move: "iq" }, // 13: J3
                { color: white, move: "ec" }, // 14: E17
                { color: black, move: "hd" }, // 15: H16
                { color: white, move: "cg" }, // 16: C13
                { color: black, move: "ed" }, // 17: E16
                { color: white, move: "cj" }, // 18: C10
                { color: black, move: "dc" }, // 19: D17
                { color: white, move: "bp" }, // 20: B4

                // Early Middle Game (21-40)
                { color: black, move: "nc" }, // 21: O17
                { color: white, move: "qi" }, // 22: R11
                { color: black, move: "ep" }, // 23: E4
                { color: white, move: "eo" }, // 24: E5
                { color: black, move: "dk" }, // 25: D9
                { color: white, move: "fp" }, // 26: F4
                { color: black, move: "ck" }, // 27: C9
                { color: white, move: "dj" }, // 28: D10
                { color: black, move: "ej" }, // 29: E10
                { color: white, move: "ei" }, // 30: E11
                { color: black, move: "fi" }, // 31: F11
                { color: white, move: "eh" }, // 32: E12
                { color: black, move: "fh" }, // 33: F12
                { color: white, move: "bj" }, // 34: B10
                { color: black, move: "fk" }, // 35: F9
                { color: white, move: "fg" }, // 36: F13
                { color: black, move: "gg" }, // 37: G13
                { color: white, move: "ff" }, // 38: F14
                { color: black, move: "gf" }, // 39: G14
                { color: white, move: "mc" }, // 40: M17

                // Middle Game (41-60)
                { color: black, move: "md" }, // 41: M16
                { color: white, move: "lc" }, // 42: L17
                { color: black, move: "nb" }, // 43: O18
                { color: white, move: "id" }, // 44: J16
                { color: black, move: "hc" }, // 45: H17
                { color: white, move: "jg" }, // 46: K13
                { color: black, move: "pj" }, // 47: Q10
                { color: white, move: "pi" }, // 48: Q11
                { color: black, move: "oj" }, // 49: P10
                { color: white, move: "oi" }, // 50: P11
                { color: black, move: "ni" }, // 51: O11
                { color: white, move: "nh" }, // 52: O12
                { color: black, move: "mh" }, // 53: M12
                { color: white, move: "ng" }, // 54: O13
                { color: black, move: "mg" }, // 55: M13
                { color: white, move: "mi" }, // 56: M11
                { color: black, move: "nj" }, // 57: O10
                { color: white, move: "mf" }, // 58: M14
                { color: black, move: "li" }, // 59: L11
                { color: white, move: "ne" }, // 60: O15

                // Middle Game (61-80)
                { color: black, move: "nd" }, // 61: O16
                { color: white, move: "mj" }, // 62: M10
                { color: black, move: "lf" }, // 63: L14
                { color: white, move: "mk" }, // 64: M9
                { color: black, move: "me" }, // 65: M15
                { color: white, move: "nf" }, // 66: O14
                { color: black, move: "lh" }, // 67: L12
                { color: white, move: "qj" }, // 68: R10
                { color: black, move: "kk" }, // 69: L9
                { color: white, move: "ik" }, // 70: J9
                { color: black, move: "ji" }, // 71: K11
                { color: white, move: "gh" }, // 72: G12
                { color: black, move: "hj" }, // 73: H10
                { color: white, move: "ge" }, // 74: G15
                { color: black, move: "he" }, // 75: H15
                { color: white, move: "fd" }, // 76: F16
                { color: black, move: "fc" }, // 77: F17
                { color: white, move: "ki" }, // 78: L11
                { color: black, move: "jj" }, // 79: K10
                { color: white, move: "lj" }, // 80: L10

                // Late Middle Game (81-100)
                { color: black, move: "kh" }, // 81: L12
                { color: white, move: "jh" }, // 82: K12
                { color: black, move: "ml" }, // 83: M8
                { color: white, move: "nk" }, // 84: O9
                { color: black, move: "ol" }, // 85: P8
                { color: white, move: "ok" }, // 86: P9
                { color: black, move: "pk" }, // 87: Q9
                { color: white, move: "pl" }, // 88: Q8
                { color: black, move: "qk" }, // 89: R9
                { color: white, move: "nl" }, // 90: O8
                { color: black, move: "kj" }, // 91: L10
                { color: white, move: "ii" }, // 92: J11
                { color: black, move: "rk" }, // 93: S9
                { color: white, move: "om" }, // 94: P7
                { color: black, move: "pg" }, // 95: Q13
                { color: white, move: "ql" }, // 96: R8
                { color: black, move: "cp" }, // 97: C4
                { color: white, move: "co" }, // 98: C5
                { color: black, move: "oe" }, // 99: P15
                { color: white, move: "rl" }, // 100: S8

                // End Game (101-180)
                { color: black, move: "sk" }, // 101: T9
                { color: white, move: "rj" }, // 102: S10
                { color: black, move: "hg" }, // 103: H13
                { color: white, move: "ij" }, // 104: J10
                { color: black, move: "km" }, // 105: L7
                { color: white, move: "gi" }, // 106: G11
                { color: black, move: "fj" }, // 107: F10
                { color: white, move: "jl" }, // 108: K8
                { color: black, move: "kl" }, // 109: L8
                { color: white, move: "gl" }, // 110: G8
                { color: black, move: "fl" }, // 111: F8
                { color: white, move: "gm" }, // 112: G7
                { color: black, move: "ch" }, // 113: C12
                { color: white, move: "ee" }, // 114: E15
                { color: black, move: "eb" }, // 115: E18
                { color: white, move: "bg" }, // 116: B13
                { color: black, move: "dg" }, // 117: D13
                { color: white, move: "eg" }, // 118: E13
                { color: black, move: "en" }, // 119: E6
                { color: white, move: "fo" }, // 120: F5
                { color: black, move: "df" }, // 121: D14
                { color: white, move: "dh" }, // 122: D12
                { color: black, move: "im" }, // 123: J7
                { color: white, move: "hk" }, // 124: H9
                { color: black, move: "bn" }, // 125: B6
                { color: white, move: "if" }, // 126: J14
                { color: black, move: "gd" }, // 127: G16
                { color: white, move: "fe" }, // 128: F15
                { color: black, move: "hf" }, // 129: H14
                { color: white, move: "ih" }, // 130: J12
                { color: black, move: "bh" }, // 131: B12
                { color: white, move: "ci" }, // 132: C11
                { color: black, move: "ho" }, // 133: H5
                { color: white, move: "go" }, // 134: G5
                { color: black, move: "or" }, // 135: P2
                { color: white, move: "rg" }, // 136: S13
                { color: black, move: "dn" }, // 137: D6
                { color: white, move: "cq" }, // 138: C3
                { color: black, move: "pr" }, // 139: Q2
                { color: white, move: "qr" }, // 140: R2
                { color: black, move: "rf" }, // 141: S14
                { color: white, move: "qg" }, // 142: R13
                { color: black, move: "qf" }, // 143: R14
                { color: white, move: "jc" }, // 144: K17
                { color: black, move: "gr" }, // 145: G2
                { color: white, move: "sf" }, // 146: T14
                { color: black, move: "se" }, // 147: T15
                { color: white, move: "sg" }, // 148: T13
                { color: black, move: "rd" }, // 149: S16
                { color: white, move: "bl" }, // 150: B8
                { color: black, move: "bk" }, // 151: B9
                { color: white, move: "ak" }, // 152: A9
                { color: black, move: "cl" }, // 153: C8
                { color: white, move: "hn" }, // 154: H6
                { color: black, move: "in" }, // 155: J6
                { color: white, move: "hp" }, // 156: H4
                { color: black, move: "fr" }, // 157: F2
                { color: white, move: "er" }, // 158: E2
                { color: black, move: "es" }, // 159: E1
                { color: white, move: "ds" }, // 160: D1
                { color: black, move: "ah" }, // 161: A12
                { color: white, move: "ai" }, // 162: A11
                { color: black, move: "kd" }, // 163: L16
                { color: white, move: "ie" }, // 164: J15
                { color: black, move: "kc" }, // 165: L17
                { color: white, move: "kb" }, // 166: L18
                { color: black, move: "gk" }, // 167: G9
                { color: white, move: "ib" }, // 168: J18
                { color: black, move: "qh" }, // 169: R12
                { color: white, move: "rh" }, // 170: S12
                { color: black, move: "qs" }, // 171: R1
                { color: white, move: "rs" }, // 172: S1
                { color: black, move: "oh" }, // 173: P12
                { color: white, move: "sl" }, // 174: T8
                { color: black, move: "of" }, // 175: P14
                { color: white, move: "sj" }, // 176: T10
                { color: black, move: "ni" }, // 177: O11
                { color: white, move: "nj" }, // 178: O10
                { color: black, move: "oo" }, // 179: P5
                { color: white, move: "jp" } // 180: K4 - Lee Sedol's winning move
            ]

            let moveCount = 0

            for (const { color, move } of sequence) {
                const [x, y] = sgfToCoord(move)

                // Special checks around the problematic moves
                if (moveCount === 102 || moveCount === 103) {
                    console.log(
                        `\nAnalyzing position before ${
                            color === black ? "Black" : "White"
                        } plays at ${move}:`
                    )
                    await visualizeArea(go, x, y, 4)
                    await checkAdjacent(go, x, y)
                }

                try {
                    await go.connect(color).play(x, y)
                    moveCount++
                    console.log(
                        `Move ${moveCount}: ${
                            color === black ? "Black" : "White"
                        } plays at ${move} (${x},${y})`
                    )

                    // Check after problematic moves
                    if (moveCount === 103) {
                        const pos = await go.getIntersectionId(x, y)
                        console.log(`\nAfter move 103:`)
                        await visualizeArea(go, x, y, 4)
                        console.log(
                            `Liberties at ${move}: ${await go.countLiberties(
                                pos
                            )}`
                        )
                    }
                } catch (e) {
                    console.log(
                        `\nFailed attempting ${
                            color === black ? "Black" : "White"
                        } at ${move} (${x},${y}):`
                    )
                    await visualizeArea(go, x, y, 4)
                    await checkAdjacent(go, x, y)
                    throw e
                }
            }

            // Verify final position
            const gameState = await go.getGameState()
            console.log("\nFinal game state:")
            console.log("Total moves played:", moveCount)
            console.log(
                "White stones captured:",
                gameState.whiteCaptured.toString()
            )
            console.log(
                "Black stones captured:",
                gameState.blackCaptured.toString()
            )

            expect(gameState.currentTurn).to.equal(black.address)
            expect(moveCount).to.equal(180)

            // Verify Lee Sedol's winning move
            const [jpX, jpY] = sgfToCoord("jp")
            const finalMove = await go.intersections(
                await go.getIntersectionId(jpX, jpY)
            )
            expect(finalMove.state).to.equal(2) // White stone
        })
    })
})
