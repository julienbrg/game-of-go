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
    const whitePlayer = "0xe61A1a5278290B6520f0CEf3F2c71Ba70CF5cf4C" // Bob
    const blackPlayer = "0xD8a394e7d7894bDF2C57139fF17e5CBAa29Dd977" // Alice

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

    // Network specific verification
    if (
        network.name === "sepolia" ||
        network.name === "optimism" ||
        network.name === "op-sepolia" ||
        network.name === "mantle-sepolia"
    ) {
        try {
            console.log("\nEtherscan verification in progress...")

            // Different waiting times for different networks
            const waitTime = network.name === "mantle-sepolia" ? 120 : 90 // Longer wait for Mantle
            await wait(waitTime * 1000)

            // Verify factory first
            if (network.name === "mantle-sepolia") {
                console.log("Verifying on Mantle Explorer...")
            }

            await hre.run("verify:verify", {
                address: factoryDeployment.address,
                constructorArguments: []
            })

            // Verify game 0
            await hre.run("verify:verify", {
                address: gameZeroAddress,
                constructorArguments: [whitePlayer, blackPlayer]
            })

            console.log("Contract verification done. ✅")

            // Add Mantle-specific explorer links
            if (network.name === "mantle-sepolia") {
                console.log("\nView contracts on Mantle Explorer:")
                console.log(
                    `Factory: https://explorer.sepolia.mantle.xyz/address/${factoryDeployment.address}`
                )
                console.log(
                    `First Game: https://explorer.sepolia.mantle.xyz/address/${gameZeroAddress}`
                )
            }
        } catch (error) {
            console.error("Verification error:", error)
            if (network.name === "mantle-sepolia") {
                console.log(
                    "\nIf verification failed, you can try manually verifying at:"
                )
                console.log("https://explorer.sepolia.mantle.xyz/")
            }
        }
    }
}

export const tags = ["Go"]
