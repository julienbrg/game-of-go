// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "./Go.sol";

contract GoFactory {
    event GameCreated(
        uint256 indexed gameId,
        address indexed white,
        address indexed black,
        address gameAddress
    );

    uint256 public gameCount;
    mapping(uint256 => address) public games;

    function createGame(address white, address black) external returns (address) {
        require(white != address(0) && black != address(0), "Invalid player addresses");
        // require(white != black, "Players must be different");

        Go newGame = new Go(white, black);
        uint256 gameId = gameCount;
        games[gameId] = address(newGame);

        emit GameCreated(gameId, white, black, address(newGame));
        gameCount++;

        return address(newGame);
    }

    function getGame(uint256 gameId) external view returns (address) {
        require(gameId < gameCount, "Game does not exist");
        return games[gameId];
    }
}
