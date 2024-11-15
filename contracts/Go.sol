// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/**
 * @title Go
 * @author Claude
 * @notice Implements the game of Go on the blockchain
 * @dev Handles game logic for two players including stone placement, liberties, captures, and scoring
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
     * @notice Checks for and handles stone captures after a move
     * @dev Evaluates neighbor groups for captures and updates the board state
     * @param _movePosition The position where the last stone was placed
     * @param _opposingColor The color of stones that might be captured
     * @return bool True if any stones were captured
     */
    function checkForCaptures(uint _movePosition, State _opposingColor) internal returns (bool) {
        bool capturedAny = false;
        (uint east, uint west, uint north, uint south) = getNeighbors(_movePosition);
        uint[] memory neighbors = new uint[](4);
        neighbors[0] = east;
        neighbors[1] = west;
        neighbors[2] = north;
        neighbors[3] = south;

        for (uint i = 0; i < 4; i++) {
            uint neighbor = neighbors[i];
            if (neighbor == 0 || intersections[neighbor].state != _opposingColor) {
                continue;
            }

            uint[] memory group = getGroup(neighbor);
            bool hasLiberties = false;

            for (uint j = 0; j < group.length && group[j] != 0; j++) {
                if (countLiberties(group[j]) > 0) {
                    hasLiberties = true;
                    break;
                }
            }

            if (!hasLiberties) {
                uint captureCount = 0;
                for (uint j = 0; j < group.length && group[j] != 0; j++) {
                    if (intersections[group[j]].state == _opposingColor) {
                        intersections[group[j]].state = State.Empty;
                        captureCount++;
                    }
                }

                if (captureCount > 0) {
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
     * @notice Counts the number of liberties (empty adjacent points) for a stone
     * @param _stonePosition Position of the stone to check
     * @return uint Number of liberties
     */
    function countLiberties(uint _stonePosition) public view returns (uint) {
        uint liberties;
        (uint east, uint west, uint north, uint south) = getNeighbors(_stonePosition);
        uint x = _stonePosition % WIDTH;
        uint y = _stonePosition / WIDTH;

        if (x < WIDTH - 1 && intersections[east].state == State.Empty) liberties++;
        if (x > 0 && intersections[west].state == State.Empty) liberties++;
        if (y < WIDTH - 1 && intersections[north].state == State.Empty) liberties++;
        if (y > 0 && intersections[south].state == State.Empty) liberties++;

        return liberties;
    }

    /**
     * @notice Gets the positions of adjacent intersections
     * @param _target Center position to find neighbors for
     * @return east East neighbor position
     * @return west West neighbor position
     * @return north North neighbor position
     * @return south South neighbor position
     */
    function getNeighbors(
        uint _target
    ) public pure returns (uint east, uint west, uint north, uint south) {
        uint x = _target % WIDTH;
        uint y = _target / WIDTH;

        if (x < WIDTH - 1) east = _target + 1;
        if (x > 0) west = _target - 1;
        if (y < WIDTH - 1) north = _target + WIDTH;
        if (y > 0) south = _target - WIDTH;
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

    /**
     * @notice Finds all connected stones of the same color
     * @param _target Starting position to check for connected stones
     * @return uint[] Array of connected stone positions
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
     * @dev Checks if a value exists in an array
     * @param arr Array to search
     * @param val Value to find
     * @param size Number of valid elements in the array
     * @return bool True if value is found
     */
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
