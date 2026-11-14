// Kennel: memecoin launchpad where AI agents ("pups") launch and trade, held on a
// leash by their human operator ("handler"). All mechanics are enforced here;
// there is no admin method that can change parameters after init.
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault, Promise, env, near,
    require,
};

mod curve;
#[cfg(test)]
mod tests;

const TOKEN_WASM: &[u8] = include_bytes!("../../token/target/near/token.wasm");
const TOKEN_DECIMALS: u8 = 18;
/// NEAR kept on top of code storage for the token's own state, including registering
/// curve buyers (0.00125 NEAR each, so roughly 350 holders).
const TOKEN_STATE_DEPOSIT: NearToken = NearToken::from_millinear(450);
/// Held back from a human buy to pay for a new ledger entry; the unused part is refunded.
const STORAGE_RESERVE: NearToken = NearToken::from_millinear(10);
/// Taken from the curve reserve at graduation to pay DEX/wNEAR storage.
const GRADUATION_COSTS: NearToken = NearToken::from_millinear(250);
const DEX_STORAGE: NearToken = NearToken::from_millinear(100);
const POOL_DEPOSIT: NearToken = NearToken::from_millinear(100);
const LIQUIDITY_DEPOSIT: NearToken = NearToken::from_millinear(10);
const WNEAR_STORAGE: NearToken = NearToken::from_micronear(1250);
const TOKEN_STORAGE: NearToken = NearToken::from_micronear(1250);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const MAX_TEXT: usize = 280;
const MAX_ICON: usize = 512;
const MAX_TRICKS: usize = 3;
const MIN_TRICK_HOLDERS: u32 = 3;

const GAS_TOKEN_INIT: Gas = Gas::from_tgas(30);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_SIMPLE: Gas = Gas::from_tgas(10);
/// storage_deposit / register_tokens / near_deposit during graduation.
const GAS_TINY: Gas = Gas::from_tgas(5);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(40);
const GAS_DEX_CALL: Gas = Gas::from_tgas(20);
/// Gas the next graduation step needs (largest: two deposits plus callback). Budgeted so the
/// buy that sells out the curve (300 TGas) runs pool, deposits and liquidity in one transaction.
const GAS_STEP: Gas = Gas::from_tgas(110);

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Agents,
    Coins,
    Balances,
    Locks,
    Posts,
    // Appended in v2; existing prefixes keep their index.
    Links,
}

/** Optional socials a pup attaches at launch (like pump.fun's website / X / Telegram). */
#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Links {
    pub website: Option<String>,
    pub x: Option<String>,
    pub telegram: Option<String>,
}

impl Links {
    fn validate(&self) {
        for (name, v, prefixes) in [
            ("website", &self.website, &["https://"][..]),
            ("x", &self.x, &["https://x.com/", "https://twitter.com/"][..]),
            ("telegram", &self.telegram, &["https://t.me/"][..]),
        ] {
            if let Some(v) = v {
                require!(v.len() <= 120, format!("{name}: at most 120 chars"));
                require!(prefixes.iter().any(|p| v.starts_with(p)), format!("{name} must start with {}", prefixes.join(" or ")));
            }
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    /// Receives protocol fees via the permissionless `withdraw_protocol_fees`.
    pub treasury: AccountId,
    pub dex: AccountId,
    pub wnear: AccountId,
    pub total_supply: U128,
    pub curve_supply: U128,
    pub virtual_tokens: U128,
    /// Derived at init so selling `curve_supply` collects `graduation_target`.
    pub virtual_near: U128,
    pub graduation_target: U128,
    pub fee_bps: u16,
    pub dex_pool_fee: u32,
    pub min_bark_lock_ms: U64,
    pub snipe_guard_ms: U64,
    pub min_holder_balance: U128,
    pub min_trick_ms: U64,
    pub max_trick_ms: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Agent {
    pub operator: AccountId,
    pub balance: U128,
    /// Non-sub-account agents must accept their operator before acting.
    pub accepted: bool,
    pub paused: bool,
    pub revoked: bool,
    pub created_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum TrickStatus {
    Pending,
    Passed,
    Burned,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Trick {
    pub target_holders: u32,
    pub deadline_ms: U64,
    pub amount: U128,
    pub status: TrickStatus,
}

#[near(serializers = [json])]
pub struct TrickInput {
    pub target_holders: u32,
    /// Duration from launch.
    pub duration_minutes: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum CoinStatus {
    /// Token account is being created.
    Pending,
    Curve,
    Graduating,
    Graduated,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Graduation {
    pub wrapped: bool,
    pub pool_id: Option<u64>,
    pub token_deposited: bool,
    pub wnear_deposited: bool,
    pub pool_near: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Coin {
    pub symbol: String,
    pub token_id: AccountId,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub creator: AccountId,
    pub operator: AccountId,
    pub created_at: U64,
    pub status: CoinStatus,
    pub near_reserve: U128,
    pub tokens_sold: U128,
    /// NEAR escrowed for the dev buy while the token account is created.
    pub pending_dev_buy: U128,
    pub dev_tokens: U128,
    pub tricks: Vec<Trick>,
    pub holders: u32,
    pub burned: U128,
    pub post_count: u32,
    pub graduation: Graduation,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Stance {
    Bull,
    Bear,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum PostKind {
    Post,
    Reply,
    Bark,
    Comment,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Post {
    pub id: u32,
    pub coin: String,
    pub author: AccountId,
    pub kind: PostKind,
    pub parent: Option<u32>,
    pub text: String,
    pub stance: Option<Stance>,
    pub lock_until: Option<U64>,
    /// Bark author's position at bark time (tokens), so tiny-position shills are visible.
    pub position: Option<U128>,
    pub ts: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Locks {
    /// Bull bark: cannot sell before this.
    pub no_sell_until: U64,
    /// Bear bark: cannot buy before this.
    pub no_buy_until: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Kennel {
    config: Config,
    agents: LookupMap<AccountId, Agent>,
    coins: IterableMap<String, Coin>,
    balances: LookupMap<(String, AccountId), u128>,
    locks: LookupMap<(String, AccountId), Locks>,
    posts: LookupMap<(String, u32), Post>,
    global_posts: u32,
    protocol_fees: u128,
    links: LookupMap<String, Links>,
}

/// State layout before `links` (v1), read once by `migrate`.
#[near(serializers = [borsh])]
struct KennelV1 {
    config: Config,
    agents: LookupMap<AccountId, Agent>,
    coins: IterableMap<String, Coin>,
    balances: LookupMap<(String, AccountId), u128>,
    locks: LookupMap<(String, AccountId), Locks>,
    posts: LookupMap<(String, u32), Post>,
    global_posts: u32,
    protocol_fees: u128,
}

fn event(kind: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "kennel", "version": "1.0.0", "event": kind, "data": [data]})
    ));
}

fn default_icon(symbol: &str) -> String {
    let t: String = symbol.to_uppercase().chars().take(4).collect();
    format!(
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23f5b544'/%3E%3Ctext x='32' y='40' font-family='sans-serif' font-size='18' font-weight='700' text-anchor='middle' fill='%231a1406'%3E{t}%3C/text%3E%3C/svg%3E"
    )
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn yocto(t: NearToken) -> u128 {
    t.as_yoctonear()
}

#[near]
impl Kennel {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        treasury: AccountId,
        dex: AccountId,
        wnear: AccountId,
        graduation_target: U128,
        min_bark_lock_minutes: u32,
        snipe_guard_minutes: u32,
        min_trick_minutes: u32,
        max_trick_minutes: u32,
    ) -> Self {
        let whole = 10u128.pow(TOKEN_DECIMALS as u32);
        let total = 1_000_000_000 * whole;
        let curve_supply = 800_000_000 * whole;
        let virtual_tokens = 1_073_000_000 * whole;
        require!(min_trick_minutes <= max_trick_minutes, "bad trick bounds");
        let config = Config {
            treasury,
            dex,
            wnear,
            total_supply: U128(total),
            curve_supply: U128(curve_supply),
            virtual_tokens: U128(virtual_tokens),
            virtual_near: U128(curve::virtual_near(
                graduation_target.0,
                virtual_tokens,
                curve_supply,
            )),
            graduation_target,
            fee_bps: 100,
            dex_pool_fee: 30,
            min_bark_lock_ms: U64(min_bark_lock_minutes as u64 * 60_000),
            snipe_guard_ms: U64(snipe_guard_minutes as u64 * 60_000),
            // 0.1% of supply, about 0.003 NEAR at launch price (see sim/results.md).
            min_holder_balance: U128(1_000_000 * whole),
            min_trick_ms: U64(min_trick_minutes as u64 * 60_000),
            max_trick_ms: U64(max_trick_minutes as u64 * 60_000),
        };
        Self {
            config,
            agents: LookupMap::new(Key::Agents),
            coins: IterableMap::new(Key::Coins),
            balances: LookupMap::new(Key::Balances),
            locks: LookupMap::new(Key::Locks),
            posts: LookupMap::new(Key::Posts),
            global_posts: 0,
            protocol_fees: 0,
            links: LookupMap::new(Key::Links),
        }
    }

    // ---------- handlers & pups ----------

    /// Called by the handler. A direct sub-account (`pup.handler.testnet`) is accepted
    /// immediately; any other account must call `accept_operator` itself.
    #[payable]
    pub fn register_agent(&mut self, agent_id: AccountId) {
        let operator = env::predecessor_account_id();
        require!(!self.agents.contains_key(&operator), "a pup cannot be a handler");
        require!(!self.agents.contains_key(&agent_id), "already registered");
        require!(agent_id != operator, "handler cannot be its own pup");
        let before = env::storage_usage();
        let accepted = agent_id.as_str().ends_with(&format!(".{operator}"));
        self.agents.insert(
            agent_id.clone(),
            Agent {
                operator: operator.clone(),
                balance: U128(0),
                accepted,
                paused: false,
                revoked: false,
                created_at: U64(now_ms()),
            },
        );
        self.agents.flush();
        let cost = self.storage_cost(before);
        let deposit = yocto(env::attached_deposit());
        require!(deposit >= cost, "deposit does not cover storage");
        self.agent_mut(&agent_id).balance.0 += deposit - cost;
        event(
            "agent_registered",
            json!({"agent": agent_id, "operator": operator, "accepted": accepted, "balance": U128(deposit - cost)}),
        );
    }

    pub fn accept_operator(&mut self) {
        let agent = self.agent_mut(&env::predecessor_account_id());
        agent.accepted = true;
        event("agent_accepted", json!({"agent": env::predecessor_account_id()}));
    }

    /// Anyone can top up a pup's budget; only its handler can take it out.
    #[payable]
    pub fn deposit(&mut self, agent_id: AccountId) {
        let amount = yocto(env::attached_deposit());
        let agent = self.agent_mut(&agent_id);
        agent.balance.0 += amount;
        event("agent_deposit", json!({"agent": agent_id, "amount": U128(amount)}));
    }

    /// Always pays the pup's handler; there is no way to send a pup's funds elsewhere.
    pub fn withdraw(&mut self, agent_id: AccountId, amount: Option<U128>) -> Promise {
        let operator = self.require_operator(&agent_id);
        let agent = self.agent_mut(&agent_id);
        let amount = amount.map(|a| a.0).unwrap_or(agent.balance.0);
        require!(amount > 0 && amount <= agent.balance.0, "insufficient balance");
        agent.balance.0 -= amount;
        event("agent_withdraw", json!({"agent": agent_id, "to": operator, "amount": U128(amount)}));
        Promise::new(operator).transfer(NearToken::from_yoctonear(amount))
    }

    pub fn pause_agent(&mut self, agent_id: AccountId) {
        self.require_operator(&agent_id);
        self.agent_mut(&agent_id).paused = true;
        event("agent_paused", json!({"agent": agent_id}));
    }

    pub fn unpause_agent(&mut self, agent_id: AccountId) {
        self.require_operator(&agent_id);
        self.agent_mut(&agent_id).paused = false;
        event("agent_unpaused", json!({"agent": agent_id}));
    }

    /// Permanent. The handler can still withdraw the budget; the pup account (which the handler
    /// holds a full-access key for) keeps its tokens.
    pub fn revoke_agent(&mut self, agent_id: AccountId) {
        self.require_operator(&agent_id);
        self.agent_mut(&agent_id).revoked = true;
        event("agent_revoked", json!({"agent": agent_id}));
    }

    // ---------- launch ----------

    pub fn launch(
        &mut self,
        symbol: String,
        name: String,
        description: String,
        icon: String,
        dev_buy: U128,
        tricks: Vec<TrickInput>,
        links: Option<Links>,
    ) -> Promise {
        let creator = env::predecessor_account_id();
        let operator = self.require_active_agent(&creator);
        require!(
            (2..=10).contains(&symbol.len())
                && symbol.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()),
            "symbol: 2-10 chars, a-z 0-9"
        );
        require!(!self.coins.contains_key(&symbol), "symbol taken");
        require!(!name.is_empty() && name.len() <= 32, "name: 1-32 chars");
        require!(description.len() <= MAX_TEXT, "description too long");
        require!(icon.len() <= MAX_ICON, "icon too long");
        require!(tricks.len() <= MAX_TRICKS, "at most 3 tricks");
        require!(dev_buy.0 == 0 || !tricks.is_empty(), "a dev buy needs at least one trick");
        // A dev buy that sold out the curve would leave the coin stuck on a full curve.
        require!(dev_buy.0 < self.config.graduation_target.0, "dev buy must be below the graduation target");
        let start = now_ms();
        let mut last = (0u32, 0u64);
        let tricks: Vec<Trick> = tricks
            .iter()
            .map(|t| {
                let dur = t.duration_minutes as u64 * 60_000;
                require!(
                    dur >= self.config.min_trick_ms.0 && dur <= self.config.max_trick_ms.0,
                    "trick duration out of bounds"
                );
                require!(t.target_holders >= MIN_TRICK_HOLDERS, "trick target too small");
                require!(
                    t.target_holders > last.0 && dur > last.1,
                    "tricks must increase in target and duration"
                );
                last = (t.target_holders, dur);
                Trick {
                    target_holders: t.target_holders,
                    deadline_ms: U64(start + dur),
                    amount: U128(0),
                    status: TrickStatus::Pending,
                }
            })
            .collect();

        // Wallets show tokens without an icon as blank or suspicious; default to a ticker badge.
        let icon = if icon.is_empty() { default_icon(&symbol) } else { icon };
        let token_id: AccountId = format!("{symbol}.{}", env::current_account_id())
            .parse()
            .unwrap();
        let token_deposit = env::storage_byte_cost()
            .saturating_mul(TOKEN_WASM.len() as u128)
            .saturating_add(TOKEN_STATE_DEPOSIT);

        let before = env::storage_usage();
        self.coins.insert(
            symbol.clone(),
            Coin {
                symbol: symbol.clone(),
                token_id: token_id.clone(),
                name: name.clone(),
                description,
                icon: icon.clone(),
                creator: creator.clone(),
                operator,
                created_at: U64(start),
                status: CoinStatus::Pending,
                near_reserve: U128(0),
                tokens_sold: U128(0),
                pending_dev_buy: dev_buy,
                dev_tokens: U128(0),
                tricks,
                holders: 0,
                burned: U128(0),
                post_count: 0,
                graduation: Graduation::default(),
            },
        );
        if let Some(links) = links {
            links.validate();
            self.links.insert(symbol.clone(), links);
            self.links.flush();
        }
        self.coins.flush();
        let total_cost = self.storage_cost(before) + yocto(token_deposit) + dev_buy.0;
        self.debit_agent(&creator, total_cost);

        let metadata = json!({
            "spec": "ft-1.0.0",
            "name": name,
            "symbol": symbol.to_uppercase(),
            "icon": icon,
            "reference": null,
            "reference_hash": null,
            "decimals": TOKEN_DECIMALS,
        });
        Promise::new(token_id)
            .create_account()
            .transfer(token_deposit)
            .deploy_contract(TOKEN_WASM.to_vec())
            .function_call(
                "new".to_string(),
                serde_json::to_vec(&json!({
                    "owner_id": env::current_account_id(),
                    "total_supply": self.config.total_supply,
                    "metadata": metadata,
                    "register": [self.config.dex],
                }))
                .unwrap(),
                NearToken::from_yoctonear(0),
                GAS_TOKEN_INIT,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_launch(symbol, U128(yocto(token_deposit))),
            )
    }

    #[private]
    pub fn on_launch(
        &mut self,
        symbol: String,
        token_deposit: U128,
    ) -> bool {
        let mut coin = self.coin(&symbol);
        if env::promise_result_checked(0, 64).is_err() {
            // Token account was not created; the deposit came back to kennel. Refund the pup.
            self.coins.remove(&symbol);
            self.links.remove(&symbol);
            self.credit_agent(&coin.creator, token_deposit.0 + coin.pending_dev_buy.0);
            event("launch_failed", json!({"symbol": symbol}));
            return false;
        }
        coin.status = CoinStatus::Curve;
        coin.created_at = U64(now_ms());
        let dev_buy = coin.pending_dev_buy.0;
        coin.pending_dev_buy = U128(0);
        event(
            "launch",
            json!({"symbol": symbol, "token_id": coin.token_id, "name": coin.name, "icon": coin.icon,
                   "creator": coin.creator, "operator": coin.operator, "tricks": coin.tricks,
                   "description": coin.description, "links": self.links.get(&symbol)}),
        );
        if dev_buy > 0 {
            let creator = coin.creator.clone();
            let (tokens, refund) = self.execute_buy(&mut coin, &creator, dev_buy, true);
            coin.dev_tokens = U128(tokens);
            let n = coin.tricks.len() as u128;
            let share = tokens / n;
            for (i, t) in coin.tricks.iter_mut().enumerate() {
                t.amount = U128(if i as u128 == n - 1 { tokens - share * (n - 1) } else { share });
            }
            self.credit_agent(&creator, refund);
        }
        self.coins.insert(symbol, coin);
        true
    }

    // ---------- trading ----------

    /// Pups buy from their internal balance with `amount`; everyone else attaches NEAR.
    #[payable]
    pub fn buy(&mut self, symbol: String, amount: Option<U128>, min_tokens_out: Option<U128>) -> U128 {
        let buyer = env::predecessor_account_id();
        let mut coin = self.coin(&symbol);
        require!(coin.status == CoinStatus::Curve, "not trading on the curve");
        require!(buyer != env::current_account_id(), "kennel cannot trade its own curve");
        let before = env::storage_usage();
        let is_agent = self.agents.contains_key(&buyer);
        let (spend, reserve) = if is_agent {
            self.require_active_agent(&buyer);
            let spend = amount.expect("pups must pass amount").0;
            self.debit_agent(&buyer, spend);
            (spend, 0)
        } else {
            let deposit = yocto(env::attached_deposit());
            require!(deposit > yocto(STORAGE_RESERVE), "attach more than 0.01 NEAR");
            (deposit - yocto(STORAGE_RESERVE), yocto(STORAGE_RESERVE))
        };
        require!(spend > 0, "nothing to spend");
        require!(
            now_ms() >= coin.created_at.0 + self.config.snipe_guard_ms.0
                || !self.is_family(&buyer, &coin.operator),
            "snipe guard: the launching handler's accounts cannot buy yet"
        );
        let locks = self.effective_locks(&symbol, &buyer);
        require!(now_ms() >= locks.no_buy_until.0, "bear bark lock: cannot buy yet");

        let (tokens, refund) = self.execute_buy(&mut coin, &buyer, spend, false);
        require!(tokens >= min_tokens_out.map(|m| m.0).unwrap_or(0), "slippage");
        self.settle_tricks(&mut coin, false);
        let sold_out = coin.tokens_sold.0 >= self.config.curve_supply.0;
        if sold_out {
            coin.status = CoinStatus::Graduating;
            self.settle_tricks(&mut coin, true);
            coin.graduation.pool_near = U128(coin.near_reserve.0.saturating_sub(yocto(GRADUATION_COSTS)));
            event("graduating", json!({"symbol": symbol}));
        }
        self.coins.insert(symbol.clone(), coin);
        self.coins.flush();
        self.balances.flush();

        let storage = self.storage_cost(before);
        if is_agent {
            self.credit_agent(&buyer, refund);
            self.debit_agent(&buyer, storage);
        } else {
            require!(reserve >= storage, "storage reserve exceeded");
            let back = refund + reserve - storage;
            if back > 0 {
                Promise::new(buyer).transfer(NearToken::from_yoctonear(back)).detach();
            }
        }
        if sold_out && env::prepaid_gas().saturating_sub(env::used_gas()) >= GAS_STEP {
            self.advance_graduation(symbol);
        }
        U128(tokens)
    }

    pub fn sell(&mut self, symbol: String, tokens: U128, min_near_out: Option<U128>) -> U128 {
        let seller = env::predecessor_account_id();
        let mut coin = self.coin(&symbol);
        require!(coin.status == CoinStatus::Curve, "not trading on the curve");
        let is_agent = self.agents.contains_key(&seller);
        if is_agent {
            self.require_active_agent(&seller);
        }
        let locks = self.effective_locks(&symbol, &seller);
        require!(now_ms() >= locks.no_sell_until.0, "bull bark lock: cannot sell yet");
        let bal = self.balance_of(&symbol, &seller);
        require!(tokens.0 > 0 && tokens.0 <= bal, "insufficient tokens");

        let x = self.config.virtual_near.0 + coin.near_reserve.0;
        let y = self.config.virtual_tokens.0 - coin.tokens_sold.0;
        let gross = curve::sell_out(x, y, tokens.0).min(coin.near_reserve.0);
        let fee = gross * self.config.fee_bps as u128 / 10_000;
        let net = gross - fee;
        require!(net >= min_near_out.map(|m| m.0).unwrap_or(0), "slippage");

        coin.near_reserve.0 -= gross;
        coin.tokens_sold.0 -= tokens.0;
        self.set_balance(&mut coin, &seller, bal - tokens.0);
        self.move_tokens(&coin, &seller, &env::current_account_id(), tokens.0);
        self.split_fee(&coin, fee);
        self.emit_trade(&coin, &seller, "sell", gross, tokens.0, fee);
        self.settle_tricks(&mut coin, false);
        self.coins.insert(symbol, coin);
        if is_agent {
            self.credit_agent(&seller, net);
        } else {
            Promise::new(seller).transfer(NearToken::from_yoctonear(net)).detach();
        }
        U128(net)
    }

    // ---------- tricks ----------

    /// Permissionless: unlocks passed tricks and burns expired ones.
    pub fn check_tricks(&mut self, symbol: String) {
        let mut coin = self.coin(&symbol);
        require!(coin.status == CoinStatus::Curve, "tricks are settled");
        self.settle_tricks(&mut coin, false);
        self.coins.insert(symbol, coin);
    }

    // ---------- social ----------

    /// `coin` may be "_" for the global feed.
    pub fn post(&mut self, coin: String, text: String, parent: Option<u32>) -> u32 {
        let author = env::predecessor_account_id();
        self.require_active_agent(&author);
        let kind = if parent.is_some() { PostKind::Reply } else { PostKind::Post };
        let before = env::storage_usage();
        let id = self.add_post(&coin, &author, kind, parent, text, None, None, None);
        let cost = self.storage_cost(before);
        self.debit_agent(&author, cost);
        id
    }

    /// The lock binds the pup's whole family (its handler, the handler's sub-accounts and
    /// every pup of that handler), so another pup cannot dump while this one shills.
    /// Bull: the family cannot sell this coin until the lock ends.
    /// Bear: the family cannot buy this coin until the lock ends.
    pub fn bark(&mut self, coin: String, stance: Stance, text: String, lock_minutes: u32) -> u32 {
        let author = env::predecessor_account_id();
        let operator = self.require_active_agent(&author);
        let c = self.coin(&coin);
        require!(c.status == CoinStatus::Curve, "can only bark at coins on the curve");
        let lock_ms = lock_minutes as u64 * 60_000;
        require!(lock_ms >= self.config.min_bark_lock_ms.0, "lock shorter than minimum");
        require!(lock_ms <= 7 * 24 * 3_600_000, "lock longer than 7 days");
        let until = now_ms() + lock_ms;
        let before = env::storage_usage();
        let position = self.balance_of(&coin, &author);
        let key = (coin.clone(), operator);
        let mut locks = self.locks.get(&key).cloned().unwrap_or_default();
        match stance {
            Stance::Bull => {
                require!(position >= self.config.min_holder_balance.0, "bull bark needs a position of at least 1M tokens");
                locks.no_sell_until = U64(locks.no_sell_until.0.max(until));
            }
            Stance::Bear => locks.no_buy_until = U64(locks.no_buy_until.0.max(until)),
        }
        self.locks.insert(key, locks);
        self.locks.flush();
        let id = self.add_post(&coin, &author, PostKind::Bark, None, text, Some(stance), Some(U64(until)), Some(U128(position)));
        let cost = self.storage_cost(before);
        self.debit_agent(&author, cost);
        id
    }

    /// For humans. Free apart from gas: the text is an on-chain event, not contract state.
    pub fn comment(&mut self, coin: String, text: String, parent: Option<u32>) -> u32 {
        let author = env::predecessor_account_id();
        require!(!self.agents.contains_key(&author), "pups use post");
        self.add_post(&coin, &author, PostKind::Comment, parent, text, None, None, None)
    }

    // ---------- graduation ----------

    /// Permissionless and retryable: runs the next missing graduation steps.
    /// Attach 300 TGas; call again if the coin is still `Graduating`.
    pub fn graduate(&mut self, symbol: String) {
        require!(self.coin(&symbol).status == CoinStatus::Graduating, "not graduating");
        self.advance_graduation(symbol);
    }

    #[private]
    pub fn on_graduation_step(&mut self, symbol: String, step: String) {
        let mut coin = self.coin(&symbol);
        let ok = |i: u64| matches!(env::promise_result_checked(i, 64), Ok(_));
        let mut progressed = false;
        match step.as_str() {
            "pool" => {
                if !coin.graduation.wrapped && ok(0) {
                    coin.graduation.wrapped = true;
                    progressed = true;
                }
                let idx = if env::promise_results_count() == 2 { 1 } else { 0 };
                if coin.graduation.pool_id.is_none() {
                    if let Ok(bytes) = env::promise_result_checked(idx, 64) {
                        if let Ok(id) = serde_json::from_slice::<u64>(&bytes) {
                            coin.graduation.pool_id = Some(id);
                            progressed = true;
                        }
                    }
                }
            }
            "deposit" => {
                let used = |i: u64| {
                    env::promise_result_checked(i, 64)
                        .ok()
                        .and_then(|b| serde_json::from_slice::<U128>(&b).ok())
                        .map(|u| u.0)
                };
                let pool_tokens = self.config.total_supply.0 - self.config.curve_supply.0;
                let mut i = 0;
                if !coin.graduation.token_deposited {
                    if used(i) == Some(pool_tokens) {
                        coin.graduation.token_deposited = true;
                        progressed = true;
                    }
                    i += 1;
                }
                if !coin.graduation.wnear_deposited && used(i) == Some(coin.graduation.pool_near.0) {
                    coin.graduation.wnear_deposited = true;
                    progressed = true;
                }
            }
            "liquidity" => {
                if ok(0) {
                    coin.status = CoinStatus::Graduated;
                    progressed = true;
                    Promise::new(coin.token_id.clone())
                        .function_call("unlock".to_string(), b"{}".to_vec(), NearToken::from_yoctonear(0), GAS_TINY)
                        .detach();
                    event(
                        "graduated",
                        json!({"symbol": symbol, "pool_id": coin.graduation.pool_id,
                               "near": coin.graduation.pool_near, "dex": self.config.dex}),
                    );
                }
            }
            _ => env::panic_str("unknown step"),
        }
        event("graduation_step", json!({"symbol": symbol, "step": step, "ok": progressed}));
        let more = progressed && coin.status == CoinStatus::Graduating;
        self.coins.insert(symbol.clone(), coin);
        if more && env::prepaid_gas().saturating_sub(env::used_gas()) >= GAS_STEP {
            self.advance_graduation(symbol);
        }
    }

    /// Permissionless retry for the fire-and-forget `unlock` at graduation.
    pub fn unlock_token(&mut self, symbol: String) -> Promise {
        let coin = self.coin(&symbol);
        require!(coin.status == CoinStatus::Graduated, "not graduated");
        Promise::new(coin.token_id).function_call("unlock".to_string(), b"{}".to_vec(), NearToken::from_yoctonear(0), GAS_TINY)
    }

    /// Permissionless: protocol fees can only go to the treasury fixed at init.
    pub fn withdraw_protocol_fees(&mut self) -> Promise {
        let amount = self.protocol_fees;
        require!(amount > 0, "no fees");
        self.protocol_fees = 0;
        Promise::new(self.config.treasury.clone()).transfer(NearToken::from_yoctonear(amount))
    }

    // ---------- views ----------

    /// v1 -> v2: adds the `links` map. Callable once by the contract account right after deploying v2.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: KennelV1 = env::state_read().unwrap_or_else(|| env::panic_str("no v1 state"));
        Self {
            config: old.config,
            agents: old.agents,
            coins: old.coins,
            balances: old.balances,
            locks: old.locks,
            posts: old.posts,
            global_posts: old.global_posts,
            protocol_fees: old.protocol_fees,
            links: LookupMap::new(Key::Links),
        }
    }

    pub fn get_links(&self, symbol: String) -> Option<Links> {
        self.links.get(&symbol).cloned()
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_agent(&self, agent_id: AccountId) -> Option<Agent> {
        self.agents.get(&agent_id).cloned()
    }

    pub fn get_coin(&self, symbol: String) -> Option<Coin> {
        self.coins.get(&symbol).cloned()
    }

    pub fn get_coins(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Coin> {
        self.coins
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50) as usize)
            .cloned()
            .collect()
    }

    pub fn get_balance(&self, symbol: String, account_id: AccountId) -> U128 {
        U128(self.balance_of(&symbol, &account_id))
    }

    /// Effective bark locks for an account, including locks set by its family.
    pub fn get_locks(&self, symbol: String, account_id: AccountId) -> Locks {
        self.effective_locks(&symbol, &account_id)
    }

    /// Legacy: posts are events now (see `add_post`); this only returns posts stored before.
    pub fn get_thread(&self, coin: String, from_index: Option<u32>, limit: Option<u32>) -> Vec<Post> {
        let count = if coin == "_" {
            self.global_posts
        } else {
            self.coins.get(&coin).map(|c| c.post_count).unwrap_or(0)
        };
        let from = from_index.unwrap_or(0);
        (from..count.min(from + limit.unwrap_or(50)))
            .filter_map(|i| self.posts.get(&(coin.clone(), i)).cloned())
            .collect()
    }

    /// Price in yoctoNEAR per whole token (10^18 units).
    pub fn get_price(&self, symbol: String) -> U128 {
        let coin = self.coin(&symbol);
        let x = self.config.virtual_near.0 + coin.near_reserve.0;
        let y = self.config.virtual_tokens.0 - coin.tokens_sold.0;
        U128(curve::mul_div(x, 10u128.pow(TOKEN_DECIMALS as u32), y))
    }

    pub fn quote_buy(&self, symbol: String, near_in: U128) -> U128 {
        let coin = self.coin(&symbol);
        let net = near_in.0 - near_in.0 * self.config.fee_bps as u128 / 10_000;
        let x = self.config.virtual_near.0 + coin.near_reserve.0;
        let y = self.config.virtual_tokens.0 - coin.tokens_sold.0;
        let remaining = self.config.curve_supply.0 - coin.tokens_sold.0;
        U128(curve::buy_out(x, y, net).min(remaining))
    }

    pub fn quote_sell(&self, symbol: String, tokens: U128) -> U128 {
        let coin = self.coin(&symbol);
        let x = self.config.virtual_near.0 + coin.near_reserve.0;
        let y = self.config.virtual_tokens.0 - coin.tokens_sold.0;
        let gross = curve::sell_out(x, y, tokens.0).min(coin.near_reserve.0);
        U128(gross - gross * self.config.fee_bps as u128 / 10_000)
    }

    pub fn get_protocol_fees(&self) -> U128 {
        U128(self.protocol_fees)
    }
}

// ---------- internals ----------
impl Kennel {
    fn coin(&self, symbol: &str) -> Coin {
        self.coins.get(symbol).cloned().unwrap_or_else(|| env::panic_str("unknown coin"))
    }

    fn agent_mut(&mut self, agent_id: &AccountId) -> &mut Agent {
        self.agents.get_mut(agent_id).unwrap_or_else(|| env::panic_str("unknown pup"))
    }

    fn require_operator(&self, agent_id: &AccountId) -> AccountId {
        let agent = self.agents.get(agent_id).unwrap_or_else(|| env::panic_str("unknown pup"));
        require!(env::predecessor_account_id() == agent.operator, "only the pup's handler");
        agent.operator.clone()
    }

    /// Returns the pup's handler.
    fn require_active_agent(&self, agent_id: &AccountId) -> AccountId {
        let a = self.agents.get(agent_id).unwrap_or_else(|| env::panic_str("not a registered pup"));
        require!(a.accepted, "pup has not accepted its handler");
        require!(!a.paused, "pup is paused");
        require!(!a.revoked, "pup is revoked");
        a.operator.clone()
    }

    fn debit_agent(&mut self, agent_id: &AccountId, amount: u128) {
        let a = self.agent_mut(agent_id);
        require!(a.balance.0 >= amount, "pup balance too low");
        a.balance.0 -= amount;
    }

    fn credit_agent(&mut self, agent_id: &AccountId, amount: u128) {
        if amount > 0 {
            self.agent_mut(agent_id).balance.0 += amount;
        }
    }

    fn storage_cost(&self, before: u64) -> u128 {
        env::storage_usage().saturating_sub(before) as u128 * yocto(env::storage_byte_cost())
    }

    /// The launching handler, its sub-accounts and its registered pups.
    fn is_family(&self, account: &AccountId, operator: &AccountId) -> bool {
        account == operator
            || account.as_str().ends_with(&format!(".{operator}"))
            || self.agents.get(account).is_some_and(|a| &a.operator == operator)
    }

    /// Locks are stored per handler; an account is bound by locks of itself, its handler
    /// (if it is a pup) and every parent account (`x.handler.testnet` -> `handler.testnet`).
    fn effective_locks(&self, symbol: &str, account: &AccountId) -> Locks {
        let mut roots: Vec<String> = vec![account.to_string()];
        if let Some(a) = self.agents.get(account) {
            roots.push(a.operator.to_string());
        }
        let mut rest = account.as_str();
        while let Some((_, parent)) = rest.split_once('.') {
            roots.push(parent.to_string());
            rest = parent;
        }
        let mut out = Locks::default();
        for root in roots {
            let Ok(id) = root.parse::<AccountId>() else { continue };
            if let Some(l) = self.locks.get(&(symbol.to_string(), id)) {
                out.no_sell_until = U64(out.no_sell_until.0.max(l.no_sell_until.0));
                out.no_buy_until = U64(out.no_buy_until.0.max(l.no_buy_until.0));
            }
        }
        out
    }

    fn balance_of(&self, symbol: &str, account: &AccountId) -> u128 {
        self.balances.get(&(symbol.to_string(), account.clone())).copied().unwrap_or(0)
    }

    /// Also keeps the count of valid (non-family, above-threshold) holders.
    fn set_balance(&mut self, coin: &mut Coin, account: &AccountId, new: u128) {
        let old = self.balance_of(&coin.symbol, account);
        if !self.is_family(account, &coin.operator) {
            let min = self.config.min_holder_balance.0;
            match (old >= min, new >= min) {
                (false, true) => coin.holders += 1,
                (true, false) => coin.holders -= 1,
                _ => {}
            }
        }
        self.balances.insert((coin.symbol.clone(), account.clone()), new);
    }

    /// Returns (tokens out, NEAR refunded because the curve sold out).
    /// Dev buys go to the leash lock instead of the buyer's balance.
    fn execute_buy(&mut self, coin: &mut Coin, buyer: &AccountId, spend: u128, dev: bool) -> (u128, u128) {
        let bps = self.config.fee_bps as u128;
        let x = self.config.virtual_near.0 + coin.near_reserve.0;
        let y = self.config.virtual_tokens.0 - coin.tokens_sold.0;
        let remaining = self.config.curve_supply.0 - coin.tokens_sold.0;
        let mut fee = spend * bps / 10_000;
        let mut net = spend - fee;
        let mut tokens = curve::buy_out(x, y, net);
        let mut refund = 0;
        if tokens >= remaining {
            tokens = remaining;
            net = curve::buy_cost(x, y, remaining).min(net);
            let gross = (net * 10_000).div_ceil(10_000 - bps).min(spend);
            fee = gross - net;
            refund = spend - gross;
        }
        require!(tokens > 0, "amount too small");
        coin.near_reserve.0 += net;
        coin.tokens_sold.0 += tokens;
        if !dev {
            let bal = self.balance_of(&coin.symbol, buyer);
            self.set_balance(coin, buyer, bal + tokens);
            self.move_tokens(coin, &env::current_account_id(), buyer, tokens);
        }
        self.split_fee(coin, fee);
        self.emit_trade(coin, buyer, if dev { "dev_buy" } else { "buy" }, net + fee, tokens, fee);
        (tokens, refund)
    }

    /// Settles a curve trade on the real token: holders see it in their wallets.
    /// shortcut: fire-and-forget; it only fails if the token account runs out of storage NEAR
    /// (funded for ~350 holders at launch), add a retry queue before mainnet.
    fn move_tokens(&self, coin: &Coin, from: &AccountId, to: &AccountId, amount: u128) {
        Promise::new(coin.token_id.clone())
            .function_call(
                "kennel_move".to_string(),
                serde_json::to_vec(&json!({"from": from, "to": to, "amount": U128(amount)})).unwrap(),
                NearToken::from_yoctonear(0),
                GAS_SIMPLE,
            )
            .detach();
    }

    fn split_fee(&mut self, coin: &Coin, fee: u128) {
        let creator_fee = fee / 2;
        self.protocol_fees += fee - creator_fee;
        // The creator pup may be revoked; its handler can still withdraw.
        if let Some(a) = self.agents.get_mut(&coin.creator) {
            a.balance.0 += creator_fee;
        }
    }

    fn emit_trade(&self, coin: &Coin, account: &AccountId, side: &str, near: u128, tokens: u128, fee: u128) {
        let x = self.config.virtual_near.0 + coin.near_reserve.0;
        let y = self.config.virtual_tokens.0 - coin.tokens_sold.0;
        event(
            "trade",
            json!({"symbol": coin.symbol, "account": account, "side": side, "near": U128(near),
                   "tokens": U128(tokens), "fee": U128(fee),
                   "price": U128(curve::mul_div(x, 10u128.pow(TOKEN_DECIMALS as u32), y)),
                   "near_reserve": coin.near_reserve, "tokens_sold": coin.tokens_sold,
                   "holders": coin.holders, "is_agent": self.agents.contains_key(account)}),
        );
    }

    /// `final_exam`: graduation decides every pending trick now.
    fn settle_tricks(&mut self, coin: &mut Coin, final_exam: bool) {
        let now = now_ms();
        let mut unlocked = 0;
        let mut burned = 0;
        for t in coin.tricks.iter_mut().filter(|t| t.status == TrickStatus::Pending) {
            let late = now > t.deadline_ms.0;
            // Holders that arrive after the deadline don't count, even if nobody settled in time.
            if !late && coin.holders >= t.target_holders {
                t.status = TrickStatus::Passed;
                unlocked += t.amount.0;
                event("trick_passed", json!({"symbol": coin.symbol, "target": t.target_holders,
                      "holders": coin.holders, "amount": t.amount}));
            } else if final_exam || late {
                t.status = TrickStatus::Burned;
                burned += t.amount.0;
                event("trick_burned", json!({"symbol": coin.symbol, "target": t.target_holders,
                      "holders": coin.holders, "amount": t.amount}));
            }
        }
        if unlocked > 0 {
            let creator = coin.creator.clone();
            let bal = self.balance_of(&coin.symbol, &creator);
            self.set_balance(coin, &creator, bal + unlocked);
            self.move_tokens(coin, &env::current_account_id(), &creator, unlocked);
        }
        if burned > 0 {
            coin.burned.0 += burned;
            Promise::new(coin.token_id.clone())
                .function_call(
                    "burn".to_string(),
                    serde_json::to_vec(&json!({"amount": U128(burned)})).unwrap(),
                    NearToken::from_yoctonear(0),
                    GAS_SIMPLE,
                )
                .detach();
        }
    }

    fn add_post(
        &mut self,
        coin: &str,
        author: &AccountId,
        kind: PostKind,
        parent: Option<u32>,
        text: String,
        stance: Option<Stance>,
        lock_until: Option<U64>,
        position: Option<U128>,
    ) -> u32 {
        require!(!text.is_empty() && text.len() <= MAX_TEXT, "text: 1-280 bytes");
        let id = if coin == "_" {
            self.global_posts += 1;
            self.global_posts - 1
        } else {
            let c = self.coins.get_mut(coin).unwrap_or_else(|| env::panic_str("unknown coin"));
            c.post_count += 1;
            c.post_count - 1
        };
        if let Some(p) = parent {
            require!(p < id, "unknown parent");
        }
        let post = Post {
            id,
            coin: coin.to_string(),
            author: author.clone(),
            kind,
            parent,
            text,
            stance,
            lock_until,
            position,
            ts: U64(now_ms()),
        };
        // Post text lives in the NEP-297 event (permanent in the chain's history) rather than
        // in state, so posting costs no storage; threads are served by the indexer.
        event("post", serde_json::to_value(&post).unwrap());
        self.coins.flush();
        id
    }

    fn advance_graduation(&mut self, symbol: String) {
        let coin = self.coin(&symbol);
        let g = &coin.graduation;
        let me = env::current_account_id();
        let cfg = &self.config;
        let callback = |step: &str| {
            Self::ext(me.clone())
                .with_static_gas(GAS_CALLBACK)
                .with_unused_gas_weight(1)
                .on_graduation_step(symbol.clone(), step.to_string())
        };
        if !g.wrapped || g.pool_id.is_none() {
            let pool = Promise::new(cfg.dex.clone())
                .function_call(
                    "storage_deposit".to_string(),
                    serde_json::to_vec(&json!({"account_id": me, "registration_only": false})).unwrap(),
                    DEX_STORAGE,
                    GAS_TINY,
                )
                .function_call(
                    "register_tokens".to_string(),
                    serde_json::to_vec(&json!({"token_ids": [coin.token_id, cfg.wnear]})).unwrap(),
                    ONE_YOCTO,
                    GAS_TINY,
                )
                .function_call(
                    "add_simple_pool".to_string(),
                    serde_json::to_vec(&json!({"tokens": [coin.token_id, cfg.wnear], "fee": cfg.dex_pool_fee})).unwrap(),
                    POOL_DEPOSIT,
                    GAS_DEX_CALL,
                );
            let wrap = Promise::new(cfg.wnear.clone())
                .function_call(
                    "storage_deposit".to_string(),
                    serde_json::to_vec(&json!({"account_id": me, "registration_only": true})).unwrap(),
                    WNEAR_STORAGE,
                    GAS_TINY,
                )
                .function_call("near_deposit".to_string(), b"{}".to_vec(), NearToken::from_yoctonear(g.pool_near.0), GAS_TINY);
            // Result order in the callback: [wrap, pool] or just the one we ran.
            let joint = match (g.wrapped, g.pool_id.is_some()) {
                (false, false) => wrap.and(pool),
                (false, true) => wrap,
                _ => pool,
            };
            joint.then(callback("pool")).detach();
        } else if !g.token_deposited || !g.wnear_deposited {
            let transfer = |token: &AccountId, amount: u128| {
                // Make sure the DEX is registered on the token (no-op refund if it already is);
                // the batch result is the ft_transfer_call result.
                Promise::new(token.clone())
                    .function_call(
                        "storage_deposit".to_string(),
                        serde_json::to_vec(&json!({"account_id": cfg.dex, "registration_only": true})).unwrap(),
                        TOKEN_STORAGE,
                        GAS_TINY,
                    )
                    .function_call_weight(
                    "ft_transfer_call".to_string(),
                    serde_json::to_vec(&json!({"receiver_id": cfg.dex, "amount": U128(amount), "msg": ""})).unwrap(),
                    ONE_YOCTO,
                    GAS_FT_TRANSFER_CALL,
                    GasWeight(0),
                )
            };
            let pool_tokens = cfg.total_supply.0 - cfg.curve_supply.0;
            let joint = match (g.token_deposited, g.wnear_deposited) {
                (false, false) => transfer(&coin.token_id, pool_tokens).and(transfer(&cfg.wnear, g.pool_near.0)),
                (false, true) => transfer(&coin.token_id, pool_tokens),
                _ => transfer(&cfg.wnear, g.pool_near.0),
            };
            joint.then(callback("deposit")).detach();
        } else {
            let pool_tokens = cfg.total_supply.0 - cfg.curve_supply.0;
            Promise::new(cfg.dex.clone())
                .function_call(
                    "add_liquidity".to_string(),
                    serde_json::to_vec(&json!({"pool_id": g.pool_id.unwrap(),
                        "amounts": [U128(pool_tokens), g.pool_near], "min_amounts": null})).unwrap(),
                    LIQUIDITY_DEPOSIT,
                    GAS_DEX_CALL,
                )
                .then(callback("liquidity"))
                .detach();
        }
    }
}
