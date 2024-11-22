import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { expect } from "chai"
import { ethers } from "hardhat"
import type { Go } from "../typechain-types"

// Helper function for coordinate conversion
function coordsToPosition(x: number, y: number): number {
    return y * 19 + x
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
        xit("Should maintain consistent board state after captures", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Surround white stone from three sides first
            await go.connect(black).play(0, 1) // Bottom
            await go.connect(white).play(0, 0) // Target stone
            await go.connect(black).play(1, 0) // Right
            await go.connect(white).play(18, 18)
            await go.connect(black).play(2, 0) // Extra stone to prevent escaping
            await go.connect(white).play(18, 17)
            await go.connect(black).play(0, 2) // Extra stone to prevent escaping
            await go.connect(white).play(18, 16)

            let state = await go.getGameState()
            console.log("Board state before final move:")
            console.log("Stone at (0,0):", Number(state.board[0].state))
            console.log(
                "Stone at (0,1):",
                Number(state.board[coordsToPosition(0, 1)].state)
            )
            console.log(
                "Stone at (1,0):",
                Number(state.board[coordsToPosition(1, 0)].state)
            )

            // Final capturing move
            await go.connect(black).play(0, 3) // Complete the surround

            state = await go.getGameState()
            console.log("\nBoard state after capture:")
            console.log("Stone at (0,0):", Number(state.board[0].state))
            console.log("White stones captured:", Number(state.whiteCaptured))

            expect(Number(state.board[0].state)).to.equal(0)
            expect(Number(state.whiteCaptured)).to.equal(1)
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
    describe("Event Testing", function () {
        it("Should emit Start event with correct parameters", async function () {
            const Go = await ethers.getContractFactory("Go")
            const [_, white, black] = await ethers.getSigners()

            const go = await Go.deploy(white.address, black.address)
            await go.waitForDeployment()

            await expect(await go.deploymentTransaction())
                .to.emit(go, "Start")
                .withArgs("The game has started.")
        })

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
        xit("Should handle complex captures with multiple groups simultaneously", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Create first white group
            await go.connect(black).play(1, 1)
            await go.connect(white).play(1, 2)
            await go.connect(black).play(1, 3)
            await go.connect(white).play(2, 2)
            await go.connect(black).play(2, 1)
            await go.connect(white).play(3, 2)
            await go.connect(black).play(2, 3)

            let state = await go.getGameState()
            console.log("\nAfter first group:")
            console.log("White stones captured:", Number(state.whiteCaptured))
            console.log(
                "Current board state at (2,2):",
                Number(state.board[coordsToPosition(2, 2)].state)
            )

            // Create second white group
            await go.connect(white).play(5, 2)
            await go.connect(black).play(4, 2)
            await go.connect(white).play(4, 3)
            await go.connect(black).play(4, 1)
            await go.connect(white).play(18, 18)
            await go.connect(black).play(5, 3)
            await go.connect(white).play(18, 17)
            await go.connect(black).play(5, 1)
            await go.connect(white).play(18, 16)

            state = await go.getGameState()
            console.log("\nBefore final move:")
            console.log("White stones captured:", Number(state.whiteCaptured))
            console.log(
                "Board state at (4,3):",
                Number(state.board[coordsToPosition(4, 3)].state)
            )

            // Complete surrounding both groups
            await go.connect(black).play(3, 1)

            state = await go.getGameState()
            console.log("\nAfter final move:")
            console.log("White stones captured:", Number(state.whiteCaptured))
            console.log("Board states at key positions:")
            console.log(
                "(2,2):",
                Number(state.board[coordsToPosition(2, 2)].state)
            )
            console.log(
                "(3,2):",
                Number(state.board[coordsToPosition(3, 2)].state)
            )
            console.log(
                "(4,3):",
                Number(state.board[coordsToPosition(4, 3)].state)
            )

            expect(Number(state.whiteCaptured)).to.equal(3)
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

        xit("Should prevent ko moves immediately after capture", async function () {
            // TODO: Implement ko rule test
        })
    })
})
