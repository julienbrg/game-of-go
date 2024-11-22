import { loadFixture } from "@nomicfoundation/hardhat-network-helpers"
import { expect } from "chai"
import { ethers } from "hardhat"
import { Go } from "../typechain-types"

describe("Go Game", function () {
    // Common fixture for all tests
    async function deployGameFixture() {
        const [deployer, white, black, attacker] = await ethers.getSigners()
        const Go = await ethers.getContractFactory("Go")
        const go = await Go.deploy(white.address, black.address)
        return { go, deployer, white, black, attacker }
    }

    describe("Game Setup", function () {
        it("correctly initializes player addresses", async function () {
            const { go, white, black } = await loadFixture(deployGameFixture)
            expect(await go.white()).to.equal(white.address)
            expect(await go.black()).to.equal(black.address)
        })

        it("sets black player to move first", async function () {
            const { go, black } = await loadFixture(deployGameFixture)
            expect(await go.turn()).to.equal(black.address)
        })

        it("initializes an empty board", async function () {
            const { go } = await loadFixture(deployGameFixture)
            const { board } = await go.getGameState()
            // Check a few random positions to ensure they're empty
            expect(board[0].state).to.equal(0) // Empty is 0
            expect(board[180].state).to.equal(0) // Middle of board
            expect(board[360].state).to.equal(0) // Last position
        })
    })

    describe("Move Validation", function () {
        it("prevents unauthorized players from making moves", async function () {
            const { go, attacker } = await loadFixture(deployGameFixture)
            await expect(
                go.connect(attacker).play(0, 0)
            ).to.be.revertedWithCustomError(go, "CallerNotAllowedToPlay")
        })

        it("prevents playing out of turn", async function () {
            const { go, white } = await loadFixture(deployGameFixture)
            await expect(
                go.connect(white).play(0, 0)
            ).to.be.revertedWithCustomError(go, "NotYourTurn")
        })

        it("prevents playing on occupied intersections", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).play(0, 0)
            await go.connect(white).play(1, 0)
            await expect(
                go.connect(black).play(0, 0)
            ).to.be.revertedWithCustomError(go, "CannotPlayHere")
        })

        it("prevents playing outside board boundaries", async function () {
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
        it("correctly alternates turns after valid moves", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).play(0, 0)
            expect(await go.turn()).to.equal(white.address)
            await go.connect(white).play(0, 1)
            expect(await go.turn()).to.equal(black.address)
        })

        it("correctly places stones on the board", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).play(0, 0)
            await go.connect(white).play(1, 1)

            const { board } = await go.getGameState()
            expect(board[0].state).to.equal(1) // Black stone
            expect(board[20].state).to.equal(2) // White stone (1 + 19 positions)
        })

        it("emits Move event on valid moves", async function () {
            const { go, black } = await loadFixture(deployGameFixture)
            await expect(go.connect(black).play(0, 0))
                .to.emit(go, "Move")
                .withArgs("Black", 0, 0)
        })
    })

    describe("Passing Mechanics", function () {
        it("allows players to pass their turn", async function () {
            const { go, black } = await loadFixture(deployGameFixture)
            await expect(go.connect(black).pass()).to.not.be.reverted
        })

        it("correctly tracks passed states", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).pass()
            const state = await go.getGameState()
            expect(state.isBlackPassed).to.be.true
            expect(state.isWhitePassed).to.be.false
        })

        it("ends game after two consecutive passes", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).pass()
            await go.connect(white).pass()
            const state = await go.getGameState()
            expect(state.isBlackPassed && state.isWhitePassed).to.be.true
        })

        it("resets pass state after a move", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).pass()
            await go.connect(white).play(0, 0)
            const state = await go.getGameState()
            expect(state.isBlackPassed).to.be.true
            expect(state.isWhitePassed).to.be.false
        })
    })

    describe("Capture Mechanics", function () {
        it("captures a single stone with no liberties", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            // Surround white stone
            await go.connect(black).play(1, 0)
            await go.connect(white).play(1, 1)
            await go.connect(black).play(0, 1)
            await go.connect(white).play(18, 18) // Pass-like move
            await go.connect(black).play(1, 2)
            await go.connect(white).play(18, 17) // Pass-like move
            await go.connect(black).play(2, 1)

            const state = await go.getGameState()
            expect(state.whiteCaptured).to.equal(1)
        })

        it("captures multiple stones in a group", async function () {
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

        it("prevents suicide moves", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            // Create a position where playing would be suicide
            await go.connect(black).play(0, 1)
            await go.connect(white).play(18, 18)
            await go.connect(black).play(1, 0)
            await go.connect(white).play(18, 17)
            await go.connect(black).play(1, 2)

            // Attempt suicide move
            await expect(
                go.connect(white).play(0, 0)
            ).to.be.revertedWithCustomError(go, "NoLiberties")
        })
    })

    describe("Liberty Counting", function () {
        it("correctly counts liberties for a single stone", async function () {
            const { go, black } = await loadFixture(deployGameFixture)
            await go.connect(black).play(1, 1) // Middle position
            expect(await go.countLiberties(20)).to.equal(4) // Should have 4 liberties
        })

        it("correctly counts liberties for edge stones", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            await go.connect(black).play(0, 0) // Corner position
            expect(await go.countLiberties(0)).to.equal(2) // Should have 2 liberties
        })
    })

    describe("Game State Management", function () {
        it("correctly tracks captured stones", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            // Capture sequence
            await go.connect(black).play(0, 1)
            await go.connect(white).play(0, 0)
            await go.connect(black).play(1, 0)
            await go.connect(white).play(18, 18)
            await go.connect(black).play(0, 2)

            const state = await go.getGameState()
            expect(state.whiteCaptured).to.equal(1)
            expect(state.blackCaptured).to.equal(0)
        })

        it("maintains correct game state after multiple moves", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)
            // Play several moves
            await go.connect(black).play(0, 0)
            await go.connect(white).play(0, 1)
            await go.connect(black).play(1, 0)

            const state = await go.getGameState()
            expect(state.board[0].state).to.equal(1) // Black
            expect(state.board[19].state).to.equal(2) // White
            expect(state.board[1].state).to.equal(1) // Black
        })
    })
})
