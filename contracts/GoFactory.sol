// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "./Go.sol";

/**
 * @title GoFactory
 * @author Julien Béranger (https://github.com/julienbrg)
 * @notice Factory contract for creating new Go game instances
 * @dev Manages creation and tracking of Go game contracts
 */
contract GoFactory {
    /**
     * @notice Emitted when a new game is created
     * @param gameId Unique identifier for the game
     * @param white Address of the white player
     * @param black Address of the black player
     * @param gameAddress Address of the deployed game contract
     */
    event GameCreated(
        uint256 indexed gameId,
        address indexed white,
        address indexed black,
        address gameAddress
    );

    /** @notice Total number of games created */
    uint256 public gameCount;

    /** @notice Mapping from game ID to game contract address */
    mapping(uint256 => address) public games;

    /**
     * @notice Creates a new Go game
     * @dev Deploys a new Go contract and assigns players
     * @param white Address of the white player
     * @param black Address of the black player
     * @return address Address of the newly created game
     */
    function createGame(address white, address black) external returns (address) {
        require(white != address(0) && black != address(0), "Invalid player addresses");
        // Note: Commented out to allow same player for testing
        // require(white != black, "Players must be different");

        Go newGame = new Go(white, black);
        uint256 gameId = gameCount;
        games[gameId] = address(newGame);

        emit GameCreated(gameId, white, black, address(newGame));
        gameCount++;

        return address(newGame);
    }

    /**
     * @notice Retrieves the address of a game by ID
     * @param gameId ID of the game to look up
     * @return address Address of the game contract
     */
    function getGame(uint256 gameId) external view returns (address) {
        require(gameId < gameCount, "Game does not exist");
        return games[gameId];
    }
}
