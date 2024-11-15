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

    uint public constant GOBAN = 19 * 19;
    uint public constant WIDTH = 19;
    uint public constant MAX_GROUP_SIZE = 100; // Increased from 10 to 100

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

    /**
     * @dev Constructor initializes the game with white and black players
     * @param _white Address of the white player
     * @param _black Address of the black player
     */
    constructor(address _white, address _black) {
        white = _white;
        black = _black;
        turn = black;

        // Initialize the goban
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

        if (msg.sender == white) {
            if (turn != white) revert NotYourTurn();
            intersections[move].state = State.White;
            turn = black;
            emit Move("White", _x, _y);
        }

        if (msg.sender == black) {
            if (turn != black) revert NotYourTurn();
            intersections[move].state = State.Black;
            turn = white;
            emit Move("Black", _x, _y);
        }
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

        east = x < WIDTH - 1 ? getIntersectionId(x + 1, y) : type(uint).max;
        west = x > 0 ? getIntersectionId(x - 1, y) : type(uint).max;
        north = y < WIDTH - 1 ? getIntersectionId(x, y + 1) : type(uint).max;
        south = y > 0 ? getIntersectionId(x, y - 1) : type(uint).max;
    }
}
