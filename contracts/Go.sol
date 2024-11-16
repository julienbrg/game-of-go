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

    // Separate function for processing captures
    function processCapture(uint[] memory group, State _opposingColor) private returns (uint) {
        uint captureCount = 0;
        for (uint j = 0; j < group.length && group[j] != 0; j++) {
            if (intersections[group[j]].state == _opposingColor) {
                intersections[group[j]].state = State.Empty;
                captureCount++;
            }
        }
        return captureCount;
    }

    // Modified capture processing
    function processGroupCapture(uint[] memory group, State _opposingColor) private returns (uint) {
        uint captureCount = 0;
        bool[] memory processed = new bool[](GOBAN);

        for (uint i = 0; i < group.length && group[i] != 0; i++) {
            uint pos = group[i];
            if (!processed[pos] && intersections[pos].state == _opposingColor) {
                intersections[pos].state = State.Empty;
                processed[pos] = true;
                captureCount++;
            }
        }
        return captureCount;
    }

    // Helper function to count group liberties
    function countGroupLiberties(uint[] memory group) private view returns (uint) {
        uint liberties = 0;
        bool[] memory checkedPositions = new bool[](GOBAN);

        for (uint i = 0; i < group.length && group[i] != 0; i++) {
            (uint east, uint west, uint north, uint south) = getNeighbors(group[i]);

            // Check each neighbor
            if (east != 0 && !checkedPositions[east]) {
                checkedPositions[east] = true;
                if (intersections[east].state == State.Empty) liberties++;
            }
            if (west != 0 && !checkedPositions[west]) {
                checkedPositions[west] = true;
                if (intersections[west].state == State.Empty) liberties++;
            }
            if (north != 0 && !checkedPositions[north]) {
                checkedPositions[north] = true;
                if (intersections[north].state == State.Empty) liberties++;
            }
            if (south != 0 && !checkedPositions[south]) {
                checkedPositions[south] = true;
                if (intersections[south].state == State.Empty) liberties++;
            }
        }
        return liberties;
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

    // Helper function to validate coordinates
    function isValidPosition(uint x, uint y) private pure returns (bool) {
        return x < WIDTH && y < WIDTH;
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

    function hasConnection(uint pos1, uint pos2) private view returns (bool) {
        if (pos1 >= GOBAN || pos2 >= GOBAN) return false;
        if (intersections[pos1].state != intersections[pos2].state) return false;
        if (intersections[pos1].state == State.Empty) return false;

        // Get coordinates
        (uint x1, uint y1) = positionToCoords(pos1);
        (uint x2, uint y2) = positionToCoords(pos2);

        // Check if adjacent
        return ((x1 == x2 && (y1 + 1 == y2 || y1 == y2 + 1)) ||
            (y1 == y2 && (x1 + 1 == x2 || x1 == x2 + 1)));
    }

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
            // Pop from stack
            stackSize--;
            uint currentPos = stack[stackSize];

            if (!visited[currentPos]) {
                visited[currentPos] = true;
                group[groupSize++] = currentPos;

                // Get the current stone's coordinates
                (uint currentX, uint currentY) = getIntersection(currentPos);

                // Explicitly check each direction and add connected stones of same color

                // Check North
                if (currentY < WIDTH - 1) {
                    uint northPos = getIntersectionId(currentX, currentY + 1);
                    if (!visited[northPos] && intersections[northPos].state == targetState) {
                        stack[stackSize++] = northPos;
                    }
                }

                // Check South
                if (currentY > 0) {
                    uint southPos = getIntersectionId(currentX, currentY - 1);
                    if (!visited[southPos] && intersections[southPos].state == targetState) {
                        stack[stackSize++] = southPos;
                    }
                }

                // Check East
                if (currentX < WIDTH - 1) {
                    uint eastPos = getIntersectionId(currentX + 1, currentY);
                    if (!visited[eastPos] && intersections[eastPos].state == targetState) {
                        stack[stackSize++] = eastPos;
                    }
                }

                // Check West
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

    function checkForCaptures(uint _movePosition, State _opposingColor) internal returns (bool) {
        bool capturedAny = false;
        bool[] memory processed = new bool[](GOBAN);
        uint totalCaptured = 0;

        // Get position coordinates
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

            // Check group for liberties
            for (uint j = 0; j < group.length && group[j] != 0; j++) {
                uint pos = group[j];
                if (countLiberties(pos) > 0) {
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

    function hasGroupLiberties(uint[] memory group) private view returns (bool) {
        bool[] memory checked = new bool[](GOBAN);

        for (uint i = 0; i < group.length && group[i] != 0; i++) {
            (uint east, uint west, uint north, uint south) = getNeighbors(group[i]);

            if (east != 0 && !checked[east] && intersections[east].state == State.Empty)
                return true;
            if (west != 0 && !checked[west] && intersections[west].state == State.Empty)
                return true;
            if (north != 0 && !checked[north] && intersections[north].state == State.Empty)
                return true;
            if (south != 0 && !checked[south] && intersections[south].state == State.Empty)
                return true;

            checked[group[i]] = true;
        }
        return false;
    }

    // Helper function for getGroup
    function contains(uint[] memory arr, uint val, uint size) private pure returns (bool) {
        for (uint i = 0; i < size; i++) {
            if (arr[i] == val) return true;
        }
        return false;
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
}
