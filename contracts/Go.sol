// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/**
 * @title Go
 * @dev Implementation of the game of Go in Solidity
 * @custom:security-contact julien@beren.dev
 */
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

    struct Intersection {
        uint x;
        uint y;
        State state;
    }

    Intersection[361] public intersections;

    enum State {
        Black,
        White,
        Empty
    }

    event Start(string indexed statement);
    event Move(string indexed player, uint indexed x, uint indexed y);
    event End(string indexed statement, int indexed blackScore, int indexed whiteScore);
    event Capture(string indexed player, uint indexed count);

    /**
     * @dev Constructor initializes the game with white and black players
     * @param _white Address of the white player
     * @param _black Address of the black player
     */
    constructor(address _white, address _black) {
        white = _white;
        black = _black;
        turn = black;

        uint i;
        intersections[0] = Intersection({x: 0, y: 0, state: State.Empty});
        for (uint k; k < WIDTH; k++) {
            for (uint j; j < WIDTH; j++) {
                intersections[i++] = Intersection({x: j, y: k, state: State.Empty});
            }
        }
        require(i == GOBAN, "ERROR_DURING_GOBAN_INIT");
        emit Start("The game has started.");
    }

    /**
     * @dev Place a stone at the specified coordinates
     * @param _x X coordinate
     * @param _y Y coordinate
     */
    function play(uint _x, uint _y) public {
        if (msg.sender != white && msg.sender != black) revert CallerNotAllowedToPlay();
        if (isOffBoard(_x, _y)) revert OffBoard();

        uint move = getIntersectionId(_x, _y);
        if (intersections[move].state != State.Empty) revert CannotPlayHere();

        State playerColor = (msg.sender == white) ? State.White : State.Black;
        if (turn != (playerColor == State.White ? white : black)) revert NotYourTurn();

        // Place the stone
        intersections[move].state = playerColor;

        // Check if the placed stone has liberties
        if (countLiberties(move) == 0) {
            // Check if the move captures opponent stones
            bool capturedOpponent = checkForCaptures(
                move,
                playerColor == State.White ? State.Black : State.White
            );

            // If no captures and no liberties, the move is illegal
            if (!capturedOpponent) {
                intersections[move].state = State.Empty;
                revert NoLiberties();
            }
        }

        turn = (playerColor == State.White) ? black : white;
        emit Move(playerColor == State.White ? "White" : "Black", _x, _y);
    }

    function checkForCaptures(uint _movePosition, State _opposingColor) internal returns (bool) {
        bool capturedAny = false;
        (uint east, uint west, uint north, uint south) = getNeighbors(_movePosition);
        uint[] memory neighbors = new uint[](4);
        neighbors[0] = east;
        neighbors[1] = west;
        neighbors[2] = north;
        neighbors[3] = south;

        for (uint i = 0; i < 4; i++) {
            if (
                !isOffBoard(intersections[neighbors[i]].x, intersections[neighbors[i]].y) &&
                intersections[neighbors[i]].state == _opposingColor
            ) {
                uint[] memory group = getGroup(neighbors[i]);
                bool hasLiberties = false;

                // Check if any stone in the group has liberties
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
                        intersections[group[j]].state = State.Empty;
                        captureCount++;
                    }

                    if (_opposingColor == State.White) {
                        capturedWhiteStones += captureCount;
                    } else {
                        capturedBlackStones += captureCount;
                    }

                    emit Capture(_opposingColor == State.White ? "Black" : "White", captureCount);
                    capturedAny = true;
                }
            }
        }
        return capturedAny;
    }

    /**
     * @dev Pass your turn
     */
    function pass() public {
        if (msg.sender != white && msg.sender != black) revert CallerNotAllowedToPlay();

        if (msg.sender == white) {
            turn = black;
            emit Move("White", 42, 42); // off board
        }

        if (msg.sender == black) {
            if (blackPassedOnce == true) {
                end();
            }
            blackPassedOnce = true;
            turn = white;
            emit Move("Black", 42, 42); // off board
        }
    }

    /**
     * @dev Get group of connected stones
     * @param _target Starting intersection ID
     * @return Array of connected stone IDs
     */
    function getGroup(uint _target) public view returns (uint[] memory) {
        uint[] memory group = new uint[](MAX_GROUP_SIZE);
        uint groupSize = 0;

        group[groupSize++] = _target;
        State targetState = intersections[_target].state;

        for (uint i = 0; i < groupSize; i++) {
            (uint east, uint west, uint north, uint south) = getNeighbors(group[i]);

            if (
                !isOffBoard(intersections[east].x, intersections[east].y) &&
                intersections[east].state == targetState &&
                !contains(group, east, groupSize)
            ) {
                group[groupSize++] = east;
            }

            if (
                !isOffBoard(intersections[west].x, intersections[west].y) &&
                intersections[west].state == targetState &&
                !contains(group, west, groupSize)
            ) {
                group[groupSize++] = west;
            }

            if (
                !isOffBoard(intersections[north].x, intersections[north].y) &&
                intersections[north].state == targetState &&
                !contains(group, north, groupSize)
            ) {
                group[groupSize++] = north;
            }

            if (
                !isOffBoard(intersections[south].x, intersections[south].y) &&
                intersections[south].state == targetState &&
                !contains(group, south, groupSize)
            ) {
                group[groupSize++] = south;
            }
        }

        return group;
    }

    /**
     * @dev Check if a stone ID exists in an array
     * @param arr Array to check
     * @param val Value to find
     * @param size Size of valid array elements
     * @return bool True if value exists
     */
    function contains(uint[] memory arr, uint val, uint size) private pure returns (bool) {
        for (uint i = 0; i < size; i++) {
            if (arr[i] == val) return true;
        }
        return false;
    }

    /**
     * @dev End the game and calculate scores
     */
    function end() private {
        if (blackPassedOnce != true && whitePassedOnce != true) revert MissingTwoConsecutivePass();
        blackScore = 1; // count the points instead
        whiteScore = 0;
        if (blackScore > whiteScore) {
            emit End("Black wins", blackScore, whiteScore);
        } else {
            emit End("White wins", blackScore, whiteScore);
        }
    }

    /**
     * @dev Check if coordinates are off the board
     * @param _a X coordinate
     * @param _b Y coordinate
     * @return offBoard True if coordinates are invalid
     */
    function isOffBoard(uint _a, uint _b) public view returns (bool offBoard) {
        if (getIntersectionId(_a, _b) >= GOBAN - 1) {
            return true;
        }
    }

    /**
     * @dev Get intersection ID from coordinates
     * @param _a X coordinate
     * @param _b Y coordinate
     * @return target Intersection ID
     */
    function getIntersectionId(uint _a, uint _b) public view returns (uint target) {
        for (target; target < GOBAN; target++) {
            if (intersections[target].x == _a && intersections[target].y == _b) {
                return target;
            }
        }
    }

    /**
     * @dev Get coordinates from intersection ID
     * @param _target Intersection ID
     * @return _x X coordinate
     * @return _y Y coordinate
     */
    function getIntersection(uint _target) public view returns (uint _x, uint _y) {
        return (intersections[_target].x, intersections[_target].y);
    }

    /**
     * @dev Get neighboring intersection IDs
     * @param _target Center intersection ID
     * @return east East neighbor ID
     * @return west West neighbor ID
     * @return north North neighbor ID
     * @return south South neighbor ID
     */
    function getNeighbors(
        uint _target
    ) public view returns (uint east, uint west, uint north, uint south) {
        (uint x, uint y) = getIntersection(_target);

        if (x < WIDTH - 1) {
            east = getIntersectionId(x + 1, y);
        }
        if (x > 0) {
            west = getIntersectionId(x - 1, y);
        }
        if (y < WIDTH - 1) {
            north = getIntersectionId(x, y + 1);
        }
        if (y > 0) {
            south = getIntersectionId(x, y - 1);
        }
    }

    function countLiberties(uint _stonePosition) public view returns (uint) {
        uint liberties;
        (uint east, uint west, uint north, uint south) = getNeighbors(_stonePosition);
        (uint x, uint y) = getIntersection(_stonePosition);

        if (x < WIDTH - 1 && intersections[east].state == State.Empty) liberties++;
        if (x > 0 && intersections[west].state == State.Empty) liberties++;
        if (y < WIDTH - 1 && intersections[north].state == State.Empty) liberties++;
        if (y > 0 && intersections[south].state == State.Empty) liberties++;

        return liberties;
    }
}
