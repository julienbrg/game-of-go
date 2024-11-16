import "@nomiclabs/hardhat-ethers"
import color from "cli-color"
var msg = color.xterm(39).bgXterm(128)
import hre, { ethers, network } from "hardhat"

export default async ({ getNamedAccounts, deployments }: any) => {
    const { deploy, get } = deployments
    const { deployer } = await getNamedAccounts()

    function wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    console.log("Deploying contracts with account:", deployer)

    // Get two addresses for the first game
    const whitePlayer = "0xe61A1a5278290B6520f0CEf3F2c71Ba70CF5cf4C"
    const blackPlayer = "0xe61A1a5278290B6520f0CEf3F2c71Ba70CF5cf4C"

    // Deploy Go contract first
    const go = await deploy("Go", {
        from: deployer,
        args: [whitePlayer, blackPlayer],
        log: true
    })

    // Deploy factory
    const goFactory = await deploy("GoFactory", {
        from: deployer,
        args: [],
        log: true
    })

    // Get factory deployment
    const factoryDeployment = await get("GoFactory")

    // Get the contract factory and attach it to the deployment address
    const Factory = await ethers.getContractFactory("GoFactory")
    const factory = Factory.attach(factoryDeployment.address)

    // Create first game (id 0)
    console.log("Creating first game...")
    const tx = await factory.createGame(whitePlayer, blackPlayer)
    await tx.wait()

    // Get the address of game 0
    const gameZeroAddress = await factory.getGame(0)

    console.log("GoFactory deployed to:", msg(factoryDeployment.address))
    console.log("First game (id 0) created at:", msg(gameZeroAddress))
    console.log("White player:", whitePlayer)
    console.log("Black player:", blackPlayer)

    // Verify contracts
    if (
        network.name === "sepolia" ||
        network.name === "optimism" ||
        network.name === "op-sepolia"
    ) {
        try {
            console.log("\nEtherscan verification in progress...")
            await wait(90 * 1000)

            // Verify factory
            await hre.run("verify:verify", {
                address: factoryDeployment.address,
                constructorArguments: []
            })

            // Verify game 0
            await hre.run("verify:verify", {
                address: gameZeroAddress,
                constructorArguments: [whitePlayer, blackPlayer]
            })

            console.log("Etherscan verification done. ✅")
        } catch (error) {
            console.error("Verification error:", error)
        }
    }
}

export const tags = ["Go"]
