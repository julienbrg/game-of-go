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

            // SGF Move Sequence
            await go.connect(black).play(3, 3) // B[dd]
            await go.connect(white).play(3, 2) // W[dc]
            await go.connect(black).play(15, 2) // B[pc]
            await go.connect(white).play(4, 3) // W[ed]
            await go.connect(black).play(15, 15) // B[pp]
            await go.connect(white).play(3, 4) // W[de]
            await go.connect(black).play(3, 15) // B[dp]
            await go.connect(white).play(2, 3) // W[cd]

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
    })
})
