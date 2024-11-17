import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-toolbox"
import "@nomicfoundation/hardhat-verify"
import "hardhat-deploy"
import * as dotenv from "dotenv"
dotenv.config()

const {
    SEPOLIA_RPC_ENDPOINT_URL,
    SEPOLIA_PRIVATE_KEY,
    ETHERSCAN_API_KEY,
    OPTIMISM_MAINNET_RPC_ENDPOINT_URL,
    OPTIMISM_MAINNET_PRIVATE_KEY,
    OP_ETHERSCAN_API_KEY,
    OP_SEPOLIA_RPC_ENDPOINT_URL,
    OP_SEPOLIA_PRIVATE_KEY,
    MANTLE_SEPOLIA_RPC_ENDPOINT_URL,
    MANTLE_SEPOLIA_PRIVATE_KEY,
    MANTLE_ETHERSCAN_API_KEY
} = process.env

const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",
    namedAccounts: {
        deployer: 0
    },
    networks: {
        hardhat: {
            chainId: 1337,
            allowUnlimitedContractSize: true
        },
        sepolia: {
            chainId: 11155111,
            url:
                SEPOLIA_RPC_ENDPOINT_URL ||
                "https://ethereum-sepolia.publicnode.com",
            accounts:
                SEPOLIA_PRIVATE_KEY !== undefined ? [SEPOLIA_PRIVATE_KEY] : []
        },
        "mantle-sepolia": {
            chainId: 5003,
            url:
                MANTLE_SEPOLIA_RPC_ENDPOINT_URL ||
                "https://rpc.sepolia.mantle.xyz",
            accounts:
                MANTLE_SEPOLIA_PRIVATE_KEY !== undefined
                    ? [MANTLE_SEPOLIA_PRIVATE_KEY]
                    : []
        },
        optimism: {
            chainId: 10,
            url:
                OPTIMISM_MAINNET_RPC_ENDPOINT_URL ||
                "https://mainnet.optimism.io",
            accounts:
                OPTIMISM_MAINNET_PRIVATE_KEY !== undefined
                    ? [OPTIMISM_MAINNET_PRIVATE_KEY]
                    : []
        },
        "op-sepolia": {
            chainId: 11155420,
            url:
                OP_SEPOLIA_RPC_ENDPOINT_URL ||
                "https://ethereum-sepolia.publicnode.com",
            accounts:
                OP_SEPOLIA_PRIVATE_KEY !== undefined
                    ? [OP_SEPOLIA_PRIVATE_KEY]
                    : []
        }
    },
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 1000,
                details: {
                    yul: true,
                    yulDetails: {
                        stackAllocation: true,
                        optimizerSteps: "dhfoDgvulfnTUtnIf"
                    }
                }
            }
        }
    },
    etherscan: {
        apiKey: {
            sepolia: ETHERSCAN_API_KEY || "",
            optimisticEthereum: OP_ETHERSCAN_API_KEY || "",
            "op-sepolia": OP_ETHERSCAN_API_KEY || "",
            "mantle-sepolia": MANTLE_ETHERSCAN_API_KEY || ""
        },
        customChains: [
            {
                network: "op-sepolia",
                chainId: 11155420,
                urls: {
                    apiURL: "https://api-sepolia-optimistic.etherscan.io/api",
                    browserURL: "https://sepolia-optimism.etherscan.io"
                }
            },
            {
                network: "mantle-sepolia",
                chainId: 5003,
                urls: {
                    apiURL: "https://explorer.sepolia.mantle.xyz/api",
                    browserURL: "https://explorer.sepolia.mantle.xyz"
                }
            }
        ]
    }
}

export default config
