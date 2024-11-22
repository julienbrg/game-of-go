// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

contract Go {
    error CallerNotAllowedToPlay();
    error NotYourTurn();
    error CannotPlayHere();
    error OffBoard();
    error MissingTwoConsecutivePass();
    error NoLiberties();

    uint public constant GOBAN = 19 * 19;
    uint public constant WIDTH = 19;
    uint public constant MAX_GROUP_SIZE = 100;

    address public immutable white;
    address public immutable black;
    address public turn;

    uint public capturedWhiteStones;
    uint public capturedBlackStones;
    bool public blackPassedOnce;
    bool public whitePassedOnce;
    int public blackScore;
    int public whiteScore;

    /**
     * @dev Represents a single point on the Go board
     * @param x The x coordinate
     * @param y The y coordinate
     * @param state The current state of this intersection (empty, black, or white)
     */
    struct Intersection {
        uint x;
        uint y;
        State state;
    }

    Intersection[361] public intersections;

    /**
     * @dev Represents possible states of an intersection
     */
    enum State {
        Empty,
        Black,
        White
    }

    event Start(string indexed statement);
    event Move(string indexed player, uint indexed x, uint indexed y);
    event End(string indexed statement, int indexed blackScore, int indexed whiteScore);
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
        turn = black;

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
     * @notice Places a stone on the board
     * @dev Handles turn logic, stone placement, and capture checking
     * @param _x X coordinate
     * @param _y Y coordinate
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
            emit Move("White", 42, 42);
        } else {
            blackPassedOnce = true;
            turn = white;
            emit Move("Black", 42, 42);
        }

        if (blackPassedOnce && whitePassedOnce) {
            end();
        }
    }

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
     * @notice Counts total liberties for a connected group of stones
     * @param _position Position of any stone in the group
     * @return Total number of unique liberties for the entire group
     */
    function countGroupLiberties(uint _position) public view returns (uint) {
        require(_position < GOBAN, "Invalid position");

        uint[] memory group = getGroup(_position);
        bool[] memory checkedPoints = new bool[](GOBAN);
        uint libertyCount = 0;

        // For each stone in the group
        for (uint i = 0; i < group.length && group[i] != 0; i++) {
            (uint x, uint y) = positionToCoords(group[i]);

            // Check each adjacent position
            // East
            if (x + 1 < WIDTH) {
                uint pos = coordsToPosition(x + 1, y);
                if (!checkedPoints[pos] && intersections[pos].state == State.Empty) {
                    libertyCount++;
                    checkedPoints[pos] = true;
                }
            }
            // West
            if (x > 0) {
                uint pos = coordsToPosition(x - 1, y);
                if (!checkedPoints[pos] && intersections[pos].state == State.Empty) {
                    libertyCount++;
                    checkedPoints[pos] = true;
                }
            }
            // South
            if (y + 1 < WIDTH) {
                uint pos = coordsToPosition(x, y + 1);
                if (!checkedPoints[pos] && intersections[pos].state == State.Empty) {
                    libertyCount++;
                    checkedPoints[pos] = true;
                }
            }
            // North
            if (y > 0) {
                uint pos = coordsToPosition(x, y - 1);
                if (!checkedPoints[pos] && intersections[pos].state == State.Empty) {
                    libertyCount++;
                    checkedPoints[pos] = true;
                }
            }
        }
        return libertyCount;
    }

    function checkForCaptures(uint _movePosition, State _opposingColor) internal returns (bool) {
        bool capturedAny = false;
        bool[] memory processed = new bool[](GOBAN);
        uint totalCaptured = 0;

        (uint x, uint y) = getIntersection(_movePosition);

        // Create array to store groups we need to check
        uint[] memory groupsToCheck = new uint[](4);
        uint numGroups = 0;

        // Add adjacent opposing stones to groups to check
        if (x > 0) {
            uint pos = getIntersectionId(x - 1, y);
            if (intersections[pos].state == _opposingColor && !processed[pos]) {
                groupsToCheck[numGroups++] = pos;
                processed[pos] = true;
            }
        }
        if (x + 1 < WIDTH) {
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
        if (y + 1 < WIDTH) {
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

            // Check group for liberties
            for (uint j = 0; j < group.length; j++) {
                uint pos = group[j];
                if (countLiberties(pos) > 0) {
                    hasLiberties = true;
                    break;
                }
            }

            // If no liberties, capture the group
            if (!hasLiberties) {
                for (uint j = 0; j < group.length; j++) {
                    uint pos = group[j];
                    if (intersections[pos].state == _opposingColor) {
                        intersections[pos].state = State.Empty;
                        totalCaptured++;
                    }
                }
                capturedAny = true;
            }
        }

        // Update capture count
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

    // Helper functions for position conversions
    function coordsToPosition(uint x, uint y) private pure returns (uint) {
        require(x < WIDTH && y < WIDTH, "Invalid coordinates");
        return y * WIDTH + x;
    }

    function positionToCoords(uint pos) private pure returns (uint x, uint y) {
        require(pos < GOBAN, "Invalid position");
        return (pos % WIDTH, pos / WIDTH);
    }

    function getNeighbors(
        uint pos
    ) public pure returns (uint east, uint west, uint north, uint south) {
        (uint x, uint y) = positionToCoords(pos);

        // Initialize all to 0
        east = 0;
        west = 0;
        north = 0;
        south = 0;

        // Check each direction with boundary validation
        if (x + 1 < WIDTH) {
            east = y * WIDTH + (x + 1);
        }
        if (x > 0) {
            west = y * WIDTH + (x - 1);
        }
        if (y + 1 < WIDTH) {
            north = (y + 1) * WIDTH + x;
        }
        if (y > 0) {
            south = (y - 1) * WIDTH + x;
        }
    }

    function getGroup(uint _target) public view returns (uint[] memory) {
        uint[] memory group = new uint[](MAX_GROUP_SIZE);
        bool[] memory visited = new bool[](GOBAN);
        uint groupSize = 0;

        State targetState = intersections[_target].state;
        if (targetState == State.Empty) {
            // Return empty array with correct size
            uint[] memory emptyGroup = new uint[](0);
            return emptyGroup;
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

                (uint x, uint y) = getIntersection(currentPos);

                // Check all four adjacent positions
                // Right
                if (x + 1 < WIDTH) {
                    uint rightPos = getIntersectionId(x + 1, y);
                    if (!visited[rightPos] && intersections[rightPos].state == targetState) {
                        stack[stackSize++] = rightPos;
                    }
                }
                // Left
                if (x > 0) {
                    uint leftPos = getIntersectionId(x - 1, y);
                    if (!visited[leftPos] && intersections[leftPos].state == targetState) {
                        stack[stackSize++] = leftPos;
                    }
                }
                // Up
                if (y > 0) {
                    uint upPos = getIntersectionId(x, y - 1);
                    if (!visited[upPos] && intersections[upPos].state == targetState) {
                        stack[stackSize++] = upPos;
                    }
                }
                // Down
                if (y + 1 < WIDTH) {
                    uint downPos = getIntersectionId(x, y + 1);
                    if (!visited[downPos] && intersections[downPos].state == targetState) {
                        stack[stackSize++] = downPos;
                    }
                }
            }
        }

        // Create new array with exact size needed
        uint[] memory result = new uint[](groupSize);
        for (uint i = 0; i < groupSize; i++) {
            result[i] = group[i];
        }
        return result;
    }

    // Add a helper function to print group information (for debugging)
    function getGroupInfo(
        uint _target
    ) public view returns (uint[] memory positions, uint size, State color) {
        uint[] memory group = getGroup(_target);
        return (group, group.length, intersections[_target].state);
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
        return _a >= WIDTH || _b >= WIDTH; // Checks if x or y is >= 19
    }

    /**
     * @notice Converts x,y coordinates to a board position ID
     * @param _a X coordinate
     * @param _b Y coordinate
     * @return uint Position ID
     */
    function getIntersectionId(uint _a, uint _b) public pure returns (uint) {
        // Change from: return _a + _b * WIDTH;
        // This was causing the incorrect position calculation
        return _b * WIDTH + _a;
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
