// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/**
 * @title Go
 * @author Julien Béranger (https://github.com/julienbrg)
 * @notice Implementation of the board game Go on Ethereum
 * @dev Contract handles board setup, turn-based gameplay, captures, and scoring mechanics
 */
contract Go {
    error CallerNotAllowedToPlay();
    error NotYourTurn();
    error CannotPlayHere();
    error OffBoard();
    error MissingTwoConsecutivePass();
    error NoLiberties();

    /** @notice Size of the Go board (19x19) */
    uint public constant GOBAN = 19 * 19;
    /** @notice Width/height of the Go board */
    uint public constant WIDTH = 19;
    /** @notice Maximum size for a group of connected stones */
    uint public constant MAX_GROUP_SIZE = 100;

    /** @notice Address of the white player */
    address public immutable white;
    /** @notice Address of the black player */
    address public immutable black;
    /** @notice Address of the player whose turn it currently is */
    address public turn;

    /** @notice Number of white stones that have been captured */
    uint public capturedWhiteStones;
    /** @notice Number of black stones that have been captured */
    uint public capturedBlackStones;
    /** @notice Whether black passed on their previous turn */
    bool public blackPassedOnce;
    /** @notice Whether white passed on their previous turn */
    bool public whitePassedOnce;
    /** @notice Black player's current score */
    int public blackScore;
    /** @notice White player's current score */
    int public whiteScore;

    /**
     * @notice Represents a single point on the Go board
     * @param x The x coordinate (0-18)
     * @param y The y coordinate (0-18)
     * @param state The current state of this intersection (empty, black, or white)
     */
    struct Intersection {
        uint x;
        uint y;
        State state;
    }

    /** @notice The complete game board state */
    Intersection[361] public intersections;

    /**
     * @notice Possible states for each board intersection
     * @dev Empty = 0, Black = 1, White = 2
     */
    enum State {
        Empty,
        Black,
        White
    }

    /** @notice Emitted when the game starts */
    event Start(string indexed statement);
    /** @notice Emitted when a player makes a move */
    event Move(string indexed player, uint indexed x, uint indexed y);
    /** @notice Emitted when the game ends */
    event End(string indexed statement, int indexed blackScore, int indexed whiteScore);
    /** @notice Emitted when stones are captured */
    event Capture(string indexed player, uint indexed count);

    /**
     * @notice Initializes a new game of Go
     * @dev Sets up the board and assigns players
     * @param _white Address of the white player
     * @param _black Address of the black player
     */
    constructor(address _white, address _black) {
        white = _white;
        black = _black;
        turn = black; // Black plays first in Go

        uint i;
        for (uint k; k < WIDTH; k++) {
            for (uint j; j < WIDTH; j++) {
                intersections[i++] = Intersection({x: j, y: k, state: State.Empty});
            }
        }
        require(i == GOBAN, "ERROR_DURING_GOBAN_INIT");
        emit Start("The game has started.");
    }

    /**
     * @dev Converts x,y coordinates to a board position index
     * @param x X coordinate
     * @param y Y coordinate
     * @return uint Position index
     */
    function coordsToPosition(uint x, uint y) private pure returns (uint) {
        require(x < WIDTH && y < WIDTH, "Invalid coordinates");
        return y * WIDTH + x;
    }

    /**
     * @dev Converts board position index to x,y coordinates
     * @param pos Position index
     * @return x X coordinate
     * @return y Y coordinate
     */
    function positionToCoords(uint pos) private pure returns (uint x, uint y) {
        require(pos < GOBAN, "Invalid position");
        return (pos % WIDTH, pos / WIDTH);
    }

    /**
     * @notice Places a stone on the board
     * @dev Handles turn logic, stone placement, capture checking, and liberties validation
     * @param _x X coordinate (0-18)
     * @param _y Y coordinate (0-18)
     */
    function play(uint _x, uint _y) public {
        if (msg.sender != white && msg.sender != black) revert CallerNotAllowedToPlay();
        if (isOffBoard(_x, _y)) revert OffBoard();

        State playerColor = (msg.sender == white) ? State.White : State.Black;
        address expectedTurn = (playerColor == State.White) ? white : black;
        if (turn != expectedTurn) revert NotYourTurn();

        uint move = getIntersectionId(_x, _y);
        if (intersections[move].state != State.Empty) revert CannotPlayHere();

        intersections[move].state = playerColor;

        bool hasLiberties = countLiberties(move) > 0;
        bool capturedOpponent = checkForCaptures(
            move,
            playerColor == State.White ? State.Black : State.White
        );

        if (!hasLiberties && !capturedOpponent) {
            intersections[move].state = State.Empty;
            revert NoLiberties();
        }

        turn = (msg.sender == white) ? black : white;

        if (playerColor == State.White) {
            whitePassedOnce = false;
        } else {
            blackPassedOnce = false;
        }

        emit Move(playerColor == State.White ? "White" : "Black", _x, _y);
    }

    /**
     * @notice Allows a player to pass their turn
     * @dev Two consecutive passes end the game
     */
    function pass() public {
        if (msg.sender != white && msg.sender != black) revert CallerNotAllowedToPlay();

        State playerColor = (msg.sender == white) ? State.White : State.Black;
        address expectedTurn = (playerColor == State.White) ? white : black;
        if (turn != expectedTurn) revert NotYourTurn();

        if (msg.sender == white) {
            whitePassedOnce = true;
            turn = black;
            emit Move("White", 42, 42); // Special coordinates for pass
        } else {
            blackPassedOnce = true;
            turn = white;
            emit Move("Black", 42, 42); // Special coordinates for pass
        }

        if (blackPassedOnce && whitePassedOnce) {
            end();
        }
    }

    /**
     * @notice Counts the number of liberties for a single stone
     * @param _position Board position to check
     * @return uint Number of liberties the stone has
     */
    function countLiberties(uint _position) public view returns (uint) {
        uint liberties = 0;
        (uint x, uint y) = positionToCoords(_position);

        // Check each adjacent position
        if (x + 1 < WIDTH && intersections[coordsToPosition(x + 1, y)].state == State.Empty) {
            liberties++;
        }
        if (x > 0 && intersections[coordsToPosition(x - 1, y)].state == State.Empty) {
            liberties++;
        }
        if (y + 1 < WIDTH && intersections[coordsToPosition(x, y + 1)].state == State.Empty) {
            liberties++;
        }
        if (y > 0 && intersections[coordsToPosition(x, y - 1)].state == State.Empty) {
            liberties++;
        }

        return liberties;
    }

    /**
     * @dev Checks and processes any captures resulting from the last move
     * @param _movePosition Position of the last move
     * @param _opposingColor Color of potential captured stones
     * @return bool True if any captures occurred
     */
    function checkForCaptures(uint _movePosition, State _opposingColor) internal returns (bool) {
        bool capturedAny = false;
        bool[] memory processed = new bool[](GOBAN);
        uint totalCaptured = 0;

        (uint x, uint y) = getIntersection(_movePosition);

        // Create array to store groups we need to check
        uint[] memory groupsToCheck = new uint[](4);
        uint numGroups = 0;

        // Check each adjacent position for opposing stones
        if (x > 0) {
            uint pos = getIntersectionId(x - 1, y);
            if (intersections[pos].state == _opposingColor && !processed[pos]) {
                groupsToCheck[numGroups++] = pos;
                processed[pos] = true;
            }
        }
        if (x < WIDTH - 1) {
            uint pos = getIntersectionId(x + 1, y);
            if (intersections[pos].state == _opposingColor && !processed[pos]) {
                groupsToCheck[numGroups++] = pos;
                processed[pos] = true;
            }
        }
        if (y > 0) {
            uint pos = getIntersectionId(x, y - 1);
            if (intersections[pos].state == _opposingColor && !processed[pos]) {
                groupsToCheck[numGroups++] = pos;
                processed[pos] = true;
            }
        }
        if (y < WIDTH - 1) {
            uint pos = getIntersectionId(x, y + 1);
            if (intersections[pos].state == _opposingColor && !processed[pos]) {
                groupsToCheck[numGroups++] = pos;
                processed[pos] = true;
            }
        }

        // Check each group for capture
        for (uint i = 0; i < numGroups; i++) {
            uint[] memory group = getGroup(groupsToCheck[i]);
            bool hasLiberties = false;

            // Check if group has any liberties
            for (uint j = 0; j < group.length && group[j] != 0; j++) {
                if (countLiberties(group[j]) > 0) {
                    hasLiberties = true;
                    break;
                }
            }

            // If no liberties, capture the group
            if (!hasLiberties) {
                uint captureCount = 0;
                for (uint j = 0; j < group.length && group[j] != 0; j++) {
                    uint pos = group[j];
                    if (intersections[pos].state == _opposingColor) {
                        intersections[pos].state = State.Empty;
                        captureCount++;
                    }
                }
                if (captureCount > 0) {
                    capturedAny = true;
                    totalCaptured += captureCount;
                }
            }
        }

        // Update capture counts
        if (totalCaptured > 0) {
            if (_opposingColor == State.White) {
                capturedWhiteStones += totalCaptured;
            } else {
                capturedBlackStones += totalCaptured;
            }
            emit Capture(_opposingColor == State.White ? "White" : "Black", totalCaptured);
        }

        return capturedAny;
    }

    /**
     * @notice Gets all stones in a connected group
     * @param _target Starting position to check for group
     * @return Array of positions in the connected group
     */
    function getGroup(uint _target) public view returns (uint[] memory) {
        uint[] memory group = new uint[](MAX_GROUP_SIZE);
        bool[] memory visited = new bool[](GOBAN);
        uint groupSize = 0;

        State targetState = intersections[_target].state;
        if (targetState == State.Empty) {
            return group;
        }

        // Create explicit stack for DFS
        uint[] memory stack = new uint[](GOBAN);
        uint stackSize = 1;
        stack[0] = _target;

        while (stackSize > 0) {
            stackSize--;
            uint currentPos = stack[stackSize];

            if (!visited[currentPos]) {
                visited[currentPos] = true;
                group[groupSize++] = currentPos;

                (uint currentX, uint currentY) = getIntersection(currentPos);

                // Check each direction
                if (currentY < WIDTH - 1) {
                    uint northPos = getIntersectionId(currentX, currentY + 1);
                    if (!visited[northPos] && intersections[northPos].state == targetState) {
                        stack[stackSize++] = northPos;
                    }
                }
                if (currentY > 0) {
                    uint southPos = getIntersectionId(currentX, currentY - 1);
                    if (!visited[southPos] && intersections[southPos].state == targetState) {
                        stack[stackSize++] = southPos;
                    }
                }
                if (currentX < WIDTH - 1) {
                    uint eastPos = getIntersectionId(currentX + 1, currentY);
                    if (!visited[eastPos] && intersections[eastPos].state == targetState) {
                        stack[stackSize++] = eastPos;
                    }
                }
                if (currentX > 0) {
                    uint westPos = getIntersectionId(currentX - 1, currentY);
                    if (!visited[westPos] && intersections[westPos].state == targetState) {
                        stack[stackSize++] = westPos;
                    }
                }
            }
        }

        return group;
    }

    /**
     * @dev Ends the game and calculates final scores
     */
    function end() private {
        blackScore = 1; // TO DO: implement proper scoring
        whiteScore = 0;
        emit End(blackScore > whiteScore ? "Black wins" : "White wins", blackScore, whiteScore);
    }

    /**
     * @notice Checks if coordinates are outside the board
     * @param _a X coordinate
     * @param _b Y coordinate
     * @return bool True if position is off board
     */
    function isOffBoard(uint _a, uint _b) public pure returns (bool) {
        return _a >= WIDTH || _b >= WIDTH;
    }

    /**
     * @notice Converts x,y coordinates to a board position ID
     * @param _a X coordinate
     * @param _b Y coordinate
     * @return uint Position ID
     */
    function getIntersectionId(uint _a, uint _b) public pure returns (uint) {
        return _a + _b * WIDTH;
    }

    /**
     * @notice Converts a board position ID to x,y coordinates
     * @param _target Position ID
     * @return _x X coordinate
     * @return _y Y coordinate
     */
    function getIntersection(uint _target) public pure returns (uint _x, uint _y) {
        return (_target % WIDTH, _target / WIDTH);
    }

    /**
     * @notice Gets the complete current state of the game
     * @return board Current board state
     * @return currentTurn Address of player whose turn it is
     * @return whiteCaptured Number of captured white stones
     * @return blackCaptured Number of captured black stones
     * @return isWhitePassed Whether white passed last turn
     * @return isBlackPassed Whether black passed last turn
     */
    function getGameState()
        external
        view
        returns (
            Intersection[361] memory board,
            address currentTurn,
            uint256 whiteCaptured,
            uint256 blackCaptured,
            bool isWhitePassed,
            bool isBlackPassed
        )
    {
        return (
            intersections,
            turn,
            capturedWhiteStones,
            capturedBlackStones,
            whitePassedOnce,
            blackPassedOnce
        );
    }
}
