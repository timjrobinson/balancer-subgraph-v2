import { BigDecimal, Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { Pool, User, PoolToken, PoolShare, PoolSnapshot, PriceRateProvider, Token, TokenSnapshot, TradePair, TradePairSnapshot } from '../../types/schema';
import { ERC20 } from '../../types/Vault/ERC20';
import { ONE_BD, SWAP_IN, SWAP_OUT, ZERO, ZERO_BD } from './constants';
import { getPoolAddress } from './pools';
import { Swap as SwapEvent } from '../../types/Vault/Vault';

const DAY = 24 * 60 * 60;

export function getTokenDecimals(tokenAddress: Address): i32 {
  let token = ERC20.bind(tokenAddress);
  let result = token.try_decimals();

  return result.reverted ? 0 : result.value;
}

export function tokenToDecimal(amount: BigInt, decimals: i32): BigDecimal {
  let scale = BigInt.fromI32(10)
    .pow(decimals as u8)
    .toBigDecimal();
  return amount.toBigDecimal().div(scale);
}

export function scaleDown(num: BigInt, decimals: i32): BigDecimal {
  return num.divDecimal(BigInt.fromI32(10).pow(u8(decimals)).toBigDecimal());
}

export function getPoolShareId(poolControllerAddress: Address, lpAddress: Address): string {
  return poolControllerAddress.toHex().concat('-').concat(lpAddress.toHex());
}

export function getPoolShare(poolId: string, lpAddress: Address): PoolShare {
  let poolShareId = getPoolShareId(getPoolAddress(poolId), lpAddress);
  let poolShare = PoolShare.load(poolShareId);
  if (poolShare == null) {
    return createPoolShareEntity(poolId, lpAddress);
  }
  return poolShare;
}

export function createPoolShareEntity(poolId: string, lpAddress: Address): PoolShare {
  createUserEntity(lpAddress);

  let id = getPoolShareId(getPoolAddress(poolId), lpAddress);
  let poolShare = new PoolShare(id);

  poolShare.userAddress = lpAddress.toHex();
  poolShare.poolId = poolId;
  poolShare.balance = ZERO_BD;
  poolShare.save();
  return poolShare;
}

// pool entity when created
export function newPoolEntity(poolId: string): Pool {
  let pool = new Pool(poolId);
  pool.vaultID = '2';
  pool.strategyType = i32(parseInt(poolId.slice(42, 46)));
  pool.tokensList = [];
  pool.totalWeight = ZERO_BD;
  pool.totalSwapVolume = ZERO_BD;
  pool.totalSwapFee = ZERO_BD;
  pool.totalLiquidity = ZERO_BD;
  pool.totalShares = ZERO_BD;
  pool.swapsCount = BigInt.fromI32(0);
  pool.holdersCount = BigInt.fromI32(0);

  return pool;
}

export function getPoolTokenId(poolId: string, tokenAddress: Address): string {
  return poolId.concat('-').concat(tokenAddress.toHexString());
}

export function loadPoolToken(poolId: string, tokenAddress: Address): PoolToken | null {
  return PoolToken.load(getPoolTokenId(poolId, tokenAddress));
}

export function createPoolTokenEntity(poolId: string, tokenAddress: Address): void {
  let poolTokenId = getPoolTokenId(poolId, tokenAddress);

  let token = ERC20.bind(tokenAddress);
  let symbol = '';
  let name = '';
  let decimals = 18;

  let symbolCall = token.try_symbol();
  let nameCall = token.try_name();
  let decimalCall = token.try_decimals();

  if (symbolCall.reverted) {
    // TODO
    //const symbolBytesCall = tokenBytes.try_symbol();
    //if (!symbolBytesCall.reverted) {
    //symbol = symbolBytesCall.value.toString();
  } else {
    symbol = symbolCall.value;
  }

  if (nameCall.reverted) {
    //const nameBytesCall = tokenBytes.try_name();
    //if (!nameBytesCall.reverted) {
    //name = nameBytesCall.value.toString();
    //}
  } else {
    name = nameCall.value;
  }

  if (!decimalCall.reverted) {
    decimals = decimalCall.value;
  }

  let poolToken = new PoolToken(poolTokenId);
  poolToken.poolId = poolId;
  poolToken.address = tokenAddress.toHexString();
  poolToken.name = name;
  poolToken.symbol = symbol;
  poolToken.decimals = decimals;
  poolToken.balance = ZERO_BD;
  poolToken.invested = ZERO_BD;
  poolToken.priceRate = ONE_BD;
  poolToken.save();
}

export function loadPriceRateProvider(poolId: string, tokenAddress: Address): PriceRateProvider | null {
  return PriceRateProvider.load(getPoolTokenId(poolId, tokenAddress));
}

export function getTokenPriceId(
  poolId: string,
  tokenAddress: Address,
  stableTokenAddress: Address,
  block: BigInt
): string {
  return poolId
    .concat('-')
    .concat(tokenAddress.toHexString())
    .concat('-')
    .concat(stableTokenAddress.toHexString())
    .concat('-')
    .concat(block.toString());
}

export function createPoolSnapshot(poolId: string, timestamp: i32): void {
  let dayTimestamp = timestamp - (timestamp % DAY); // Todays Timestamp

  let pool = Pool.load(poolId);
  if (pool == null) return;

  // Save pool snapshot
  let snapshotId = poolId + '-' + dayTimestamp.toString();
  let snapshot = new PoolSnapshot(snapshotId);

  if (!pool.tokensList) {
    return;
  }

  let tokens = pool.tokensList;
  let amounts = new Array<BigDecimal>(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    let tokenAddress = Address.fromString(token.toHexString());
    let poolToken = loadPoolToken(poolId, tokenAddress);
    if (poolToken == null) continue;

    amounts[i] = poolToken.balance;
  }

  snapshot.pool = poolId;
  snapshot.amounts = amounts;
  snapshot.totalShares = pool.totalShares;
  snapshot.swapVolume = ZERO_BD;
  snapshot.swapFees = pool.totalSwapFee;
  snapshot.timestamp = dayTimestamp;
  snapshot.save();
}

export function saveSwapToSnapshot(poolAddress: string, timestamp: i32, volume: BigDecimal, fees: BigDecimal): void {
  let dayTimestamp = timestamp - (timestamp % DAY); // Todays timestamp

  // Save pool snapshot
  let snapshotId = poolAddress + '-' + dayTimestamp.toString();
  let snapshot = PoolSnapshot.load(snapshotId);

  if (!snapshot) {
    return;
  }

  snapshot.swapVolume = snapshot.swapVolume.plus(volume);
  snapshot.swapFees = snapshot.swapFees.plus(fees);
  snapshot.save();
}

export function createUserEntity(address: Address): void {
  let addressHex = address.toHex();
  if (User.load(addressHex) == null) {
    let user = new User(addressHex);
    user.save();
  }
}

export function createToken(tokenAddress: Address): Token {
  let erc20token = ERC20.bind(tokenAddress);
  let token = new Token(tokenAddress.toHexString());
  let name = '';
  let symbol = '';
  let decimals = 0;

  // attempt to retrieve erc20 values
  let maybeName = erc20token.try_name();
  let maybeSymbol = erc20token.try_symbol();
  let maybeDecimals = erc20token.try_decimals();

  if (!maybeName.reverted) name = maybeName.value;
  if (!maybeSymbol.reverted) symbol = maybeSymbol.value;
  if (!maybeDecimals.reverted) decimals = maybeDecimals.value;

  token.name = name;
  token.symbol = symbol;
  token.decimals = decimals;
  token.totalBalanceUSD = ZERO_BD;
  token.totalBalanceNotional = ZERO_BD;
  token.totalSwapCount = ZERO;
  token.totalVolumeUSD = ZERO_BD;
  token.totalVolumeNotional = ZERO_BD;
  token.address = tokenAddress.toHexString();
  token.save();
  return token;
}

// this will create the token entity and populate
// with erc20 values
export function getToken(tokenAddress: Address): Token {
  let token = Token.load(tokenAddress.toHexString());
  if (token == null) {
    token = createToken(tokenAddress);
  }
  return token as Token;
}

export function getTokenSnapshot(tokenAddress: Address, event: ethereum.Event): TokenSnapshot {
  let timestamp = event.block.timestamp.toI32();
  let dayID = timestamp / 86400;
  let id = tokenAddress.toHexString() + '-' + dayID.toString();
  let dayData = TokenSnapshot.load(id);

  if (dayData == null) {
    let dayStartTimestamp = dayID * 86400;
    let token = getToken(tokenAddress);
    dayData = new TokenSnapshot(id);
    dayData.timestamp = dayStartTimestamp;
    dayData.swapCount = ZERO;
    dayData.balanceUSD = ZERO_BD;
    dayData.balanceNotional = ZERO_BD;
    dayData.volumeUSD = ZERO_BD;
    dayData.volumeNotional = ZERO_BD;
    dayData.token = token.id;
    dayData.save();
  }

  return dayData as TokenSnapshot;
}

export function uptickSwapsForToken(tokenAddress: Address, event: ethereum.Event): void {
  let token = getToken(tokenAddress);
  // update the overall swap count for the token
  token.totalSwapCount = token.totalSwapCount.plus(BigInt.fromI32(1));
  token.save();

  // update the snapshots
  let snapshot = getTokenSnapshot(tokenAddress, event);
  snapshot.swapCount = token.totalSwapCount.plus(BigInt.fromI32(1));
  snapshot.save();
}

export function updateTokenBalances(
  tokenAddress: Address,
  usdBalance: BigDecimal,
  notionalBalance: BigDecimal,
  swapDirection: i32,
  event: SwapEvent
): void {
  let token = getToken(tokenAddress);
  let tokenSnapshot = getTokenSnapshot(tokenAddress, event);

  if (swapDirection == SWAP_IN) {
    token.totalBalanceNotional = token.totalBalanceNotional.plus(notionalBalance);
    tokenSnapshot.balanceNotional = tokenSnapshot.balanceNotional.plus(notionalBalance);

    token.totalBalanceUSD = token.totalBalanceUSD.plus(usdBalance);
    tokenSnapshot.balanceUSD = tokenSnapshot.balanceUSD.plus(usdBalance);
  } else if (swapDirection == SWAP_OUT) {
    token.totalBalanceNotional = token.totalBalanceNotional.minus(notionalBalance);
    tokenSnapshot.balanceNotional = tokenSnapshot.balanceNotional.minus(notionalBalance);

    token.totalBalanceUSD = token.totalBalanceUSD.minus(usdBalance);
    tokenSnapshot.balanceUSD = tokenSnapshot.balanceUSD.minus(usdBalance);
  }

  token.totalVolumeUSD = token.totalVolumeUSD.plus(usdBalance);
  tokenSnapshot.volumeUSD = tokenSnapshot.volumeUSD.plus(usdBalance);

  token.totalVolumeNotional = token.totalVolumeNotional.plus(notionalBalance);
  tokenSnapshot.volumeNotional = tokenSnapshot.volumeNotional.plus(notionalBalance);

  token.save();
  tokenSnapshot.save();
}

export function getTradePair(token0Address: Address, token1Address: Address): TradePair {
  let sortedAddressses = new Array<string>(2);
  sortedAddressses[0] = token0Address.toHexString();
  sortedAddressses[1] = token1Address.toHexString();
  sortedAddressses.sort();

  let tradePairId = sortedAddressses[0] + '-' + sortedAddressses[1];
  let tradePair = TradePair.load(tradePairId);
  if (tradePair == null) {
    tradePair = new TradePair(tradePairId);
    tradePair.token0 = sortedAddressses[0];
    tradePair.token1 = sortedAddressses[1];
    tradePair.totalSwapFee = ZERO_BD;
    tradePair.totalSwapVolume = ZERO_BD;
    tradePair.save();
  }
  return tradePair as TradePair;
}

export function getTradePairSnapshot(tradePairId: string, timestamp: i32): TradePairSnapshot {
  let dayID = timestamp / 86400;
  let id = tradePairId + '-' + dayID.toString();
  let snapshot = TradePairSnapshot.load(id);
  if (!snapshot) {
    snapshot = new TradePairSnapshot(id);
    let dayStartTimestamp = dayID * 86400;
    snapshot.pair = tradePairId;
    snapshot.timestamp = dayStartTimestamp;
    snapshot.swapVolume = ZERO_BD;
    snapshot.swapFee = ZERO_BD;
    snapshot.save();
  }
  return snapshot as TradePairSnapshot;
}