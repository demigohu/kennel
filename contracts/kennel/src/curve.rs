// Constant-product bonding curve on virtual reserves (x = NEAR, y = tokens), pump.fun style.
// Products exceed u128 (1e25 yocto * 1e27 units), so math goes through U256.
#![allow(clippy::manual_div_ceil)]
uint::construct_uint! {
    pub struct U256(4);
}

pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    (U256::from(a) * U256::from(b) / U256::from(c)).as_u128()
}

fn mul_div_ceil(a: u128, b: u128, c: u128) -> u128 {
    let c = U256::from(c);
    ((U256::from(a) * U256::from(b) + c - 1) / c).as_u128()
}

/// Virtual NEAR so that selling `curve` of `y0` virtual tokens collects exactly `target`.
pub fn virtual_near(target: u128, y0: u128, curve: u128) -> u128 {
    mul_div(target, y0 - curve, curve)
}

/// Tokens out for `dx` NEAR in.
pub fn buy_out(x: u128, y: u128, dx: u128) -> u128 {
    mul_div(y, dx, x + dx)
}

/// NEAR needed to take exactly `dy` tokens out (rounded up, in the curve's favour).
pub fn buy_cost(x: u128, y: u128, dy: u128) -> u128 {
    mul_div_ceil(x, dy, y - dy)
}

/// NEAR out for `dy` tokens in.
pub fn sell_out(x: u128, y: u128, dy: u128) -> u128 {
    mul_div(x, dy, y + dy)
}
