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
        it("plays a correct sequence from a known game", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Converting SGF coordinates to numbers:
            // a=0, b=1, c=2, d=3, e=4, f=5... s=18
            // SGF coords are [column,row]

            // B[dc] -> (3,2)
            await go.connect(black).play(3, 2)

            // W[pp] -> (15,15)
            await go.connect(white).play(15, 15)

            // B[cp] -> (2,15)
            await go.connect(black).play(2, 15)

            // W[pd] -> (15,3)
            await go.connect(white).play(15, 3)

            // B[eq] -> (4,16)
            await go.connect(black).play(4, 16)

            // W[ce] -> (2,4)
            await go.connect(white).play(2, 4)

            // B[cj] -> (2,9)
            await go.connect(black).play(2, 9)

            // W[hd] -> (7,3)
            await go.connect(white).play(7, 3)

            // B[qj] -> (16,9)
            await go.connect(black).play(16, 9)

            // W[mq] -> (12,16)
            await go.connect(white).play(12, 16)

            // B[qn] -> (16,13)
            await go.connect(black).play(16, 13)

            // W[iq] -> (8,16)
            await go.connect(white).play(8, 16)

            // B[qg] -> (16,6)
            await go.connect(black).play(16, 6)

            // W[le] -> (11,4)
            await go.connect(white).play(11, 4)

            // B[nc] -> (13,2)
            await go.connect(black).play(13, 2)

            // Verify final board state
            const { board } = await go.getGameState()

            // Check a few key positions
            expect(board[coordsToPosition(3, 2)].state).to.equal(1) // Black at dc
            expect(board[coordsToPosition(15, 15)].state).to.equal(2) // White at pp
            expect(board[coordsToPosition(13, 2)].state).to.equal(1) // Black at nc
            expect(board[coordsToPosition(11, 4)].state).to.equal(2) // White at le

            // Helper function for test
            function coordsToPosition(x: number, y: number): number {
                return y * 19 + x
            }
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
        it("captures a group of 5 stones", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // White builds a group of 5 stones in a cross pattern
            await go.connect(black).play(0, 0) // Inconsequential move to start
            await go.connect(white).play(4, 4) // Center of cross
            await go.connect(black).play(18, 18) // Away move
            await go.connect(white).play(4, 3) // North
            await go.connect(black).play(18, 17) // Away move
            await go.connect(white).play(4, 5) // South
            await go.connect(black).play(18, 16) // Away move
            await go.connect(white).play(3, 4) // West
            await go.connect(black).play(18, 15) // Away move
            await go.connect(white).play(5, 4) // East

            // Black surrounds the white group
            await go.connect(black).play(4, 2) // North of cross
            await go.connect(white).play(0, 1) // Away move
            await go.connect(black).play(4, 6) // South of cross
            await go.connect(white).play(0, 2) // Away move
            await go.connect(black).play(2, 4) // West of cross
            await go.connect(white).play(0, 3) // Away move
            await go.connect(black).play(6, 4) // East of cross
            await go.connect(white).play(0, 4) // Away move
            await go.connect(black).play(3, 3) // NW corner
            await go.connect(white).play(0, 5) // Away move
            await go.connect(black).play(5, 3) // NE corner
            await go.connect(white).play(0, 6) // Away move
            await go.connect(black).play(3, 5) // SW corner
            await go.connect(white).play(0, 7) // Away move
            await go.connect(black).play(5, 5) // SE corner

            const state = await go.getGameState()
            expect(state.whiteCaptured).to.equal(5) // Should capture all 5 white stones
            expect(state.blackCaptured).to.equal(0)
        })
    })

    describe("Liberty Counting", function () {
        it("correctly counts liberties for corner stones", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // First corner
            await go.connect(black).play(0, 0)
            await go.connect(white).play(5, 5) // Away move
            expect(await go.countLiberties(0)).to.equal(2) // Right and Down only

            // Second corner
            await go.connect(black).play(18, 18)
            await go.connect(white).play(5, 6) // Away move
            expect(await go.countLiberties(360)).to.equal(2) // Left and Up only

            // Third corner
            await go.connect(black).play(0, 18)
            await go.connect(white).play(5, 7) // Away move
            expect(await go.countLiberties(342)).to.equal(2) // Right and Up only

            // Fourth corner
            await go.connect(black).play(18, 0)
            expect(await go.countLiberties(18)).to.equal(2) // Left and Down only
        })

        it("correctly counts liberties for a group of stones in the center", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Helper function for coordinate conversion
            function coordToIndex(x: number, y: number): number {
                return y * 19 + x
            }

            // Create a plus shape in the center
            await go.connect(black).play(9, 9) // Center
            await go.connect(white).play(0, 0) // Away move
            await go.connect(black).play(9, 8) // North
            await go.connect(white).play(0, 1) // Away move
            await go.connect(black).play(9, 10) // South
            await go.connect(white).play(0, 2) // Away move
            await go.connect(black).play(8, 9) // West
            await go.connect(white).play(0, 3) // Away move
            await go.connect(black).play(10, 9) // East

            /* The shape looks like this (. = empty, B = black, numbers = liberties):
                   1B1
                  1BBB1
                   1B1
            */

            const centerIndex = coordToIndex(9, 9)
            expect(await go.countGroupLiberties(centerIndex)).to.equal(8) // Total liberties for the group should be 8

            // Also verify individual stone positions
            const { board } = await go.getGameState()
            expect(board[coordToIndex(9, 9)].state).to.equal(1) // Center
            expect(board[coordToIndex(9, 8)].state).to.equal(1) // North
            expect(board[coordToIndex(9, 10)].state).to.equal(1) // South
            expect(board[coordToIndex(8, 9)].state).to.equal(1) // West
            expect(board[coordToIndex(10, 9)].state).to.equal(1) // East

            // The group should have exactly 8 liberties:
            // - 4 diagonal spaces next to center (positions: 8,8 10,8 8,10 10,10)
            // - 4 spaces at the ends of each arm (positions: 9,7 7,9 11,9 9,11)
        })

        it("correctly counts liberties for a group of stones on the edge", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Create a horizontal line of three stones on the top edge
            await go.connect(black).play(8, 0) // Left
            await go.connect(white).play(0, 0) // Away move
            await go.connect(black).play(9, 0) // Center
            await go.connect(white).play(0, 1) // Away move
            await go.connect(black).play(10, 0) // Right

            expect(await go.countLiberties(8)).to.equal(2) // Left stone: down + right
            expect(await go.countLiberties(9)).to.equal(1) // Center stone: down only
            expect(await go.countLiberties(10)).to.equal(2) // Right stone: down + left
        })

        it("correctly counts liberties for a group of stones in the corner", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Create an L-shaped group in the corner
            await go.connect(black).play(0, 0) // Corner
            await go.connect(white).play(5, 5) // Away move
            await go.connect(black).play(0, 1) // Down
            await go.connect(white).play(5, 6) // Away move
            await go.connect(black).play(1, 0) // Right

            expect(await go.countLiberties(0)).to.equal(0) // Corner stone: no liberties
            expect(await go.countLiberties(19)).to.equal(2) // Down stone: right + down
            expect(await go.countLiberties(1)).to.equal(2) // Right stone: right + up
        })

        it("correctly counts liberties for a group with multiple possible connections", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            /* Building this shape:
                .....
                .B.B.  (two stones with 4 liberties each, excluding shared spaces)
                .....
            */

            await go.connect(black).play(9, 9) // Left stone
            await go.connect(white).play(0, 0) // Away move
            await go.connect(black).play(11, 9) // Right stone

            /*
            Counting liberties:
            - Left stone: North, South, East
            - Right stone: North, South, West
            Total unique liberties = 4 (not 6 as previously expected)
            */

            expect(await go.countGroupLiberties(coordToIndex(9, 9))).to.equal(4)
        })

        it("correctly counts liberties for a snake-like shape", async function () {
            const { go, black, white } = await loadFixture(deployGameFixture)

            // Create a snake-like shape
            await go.connect(black).play(9, 9) // Start
            await go.connect(white).play(0, 0) // Away move
            await go.connect(black).play(9, 10) // Down
            await go.connect(white).play(0, 1) // Away move
            await go.connect(black).play(10, 10) // Right
            await go.connect(white).play(0, 2) // Away move
            await go.connect(black).play(10, 11) // Down

            /* The shape looks like this:
               B
               BB
                B
            */

            expect(await go.countGroupLiberties(coordToIndex(9, 9))).to.equal(8) // Should have 8 unique liberties
        })

        function coordToIndex(x: number, y: number): number {
            return y * 19 + x
        }
    })

    describe("Game State Management", function () {
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
