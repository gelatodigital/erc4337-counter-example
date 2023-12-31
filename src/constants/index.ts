export enum ChainId {
  Goerli = 5,
  Mumbai = 80001,
  OpGoerli = 420,
}

export const ADDRESSES: { [key in ChainId]: { counter: string } } = {
  [ChainId.Goerli]: { counter: "0xD8279B27f574dEfA6b58A86388D712653DAc416b" },
  [ChainId.Mumbai]: { counter: "0xD2D3248F89Fd11117496B3258Db161a834dbFb0b" },
  [ChainId.OpGoerli]: { counter: "0x9190E6F734FE3E3AC548AF3d93B82581E8BB7ace" },
};

export const ZERODEV_API = "https://prod-api.zerodev.app";
