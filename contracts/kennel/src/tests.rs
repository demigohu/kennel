use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const MIN: u64 = 60_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn near(n: u128) -> u128 {
    n * 10u128.pow(24)
}

struct T {
    k: Kennel,
    now: u64,
}

impl T {
    fn new() -> Self {
        let now = 1_000 * MIN;
        set_ctx(now, "kennel.testnet", 0, vec![]);
        let k = Kennel::new(
            acc("treasury.testnet"),
            acc("ref-finance-101.testnet"),
            acc("wrap.testnet"),
            U128(near(10)),
            60,
            2,
            10,
            7 * 24 * 60,
        );
        let mut t = T { k, now };
        t.as_("handler.testnet", near(20)).k.register_agent(acc("doggo.handler.testnet"));
        t.as_("handler.testnet", near(20)).k.register_agent(acc("rex.handler.testnet"));
        t.as_("other.testnet", near(20)).k.register_agent(acc("luna.other.testnet"));
        t.as_("other.testnet", near(20)).k.register_agent(acc("max.other.testnet"));
        t
    }

    fn ctx(&mut self, who: &str, deposit: u128) {
        self.ctx_with(who, deposit, vec![]);
    }

    fn ctx_with(&mut self, who: &str, deposit: u128, results: Vec<PromiseResult>) {
        set_ctx(self.now, who, deposit, results);
    }

    fn as_(&mut self, who: &str, deposit: u128) -> &mut Self {
        self.ctx(who, deposit);
        self
    }

    fn wait(&mut self, minutes: u64) {
        self.now += minutes * MIN;
    }

    /// Launch `dog` by doggo and simulate a successful token deployment.
    fn launch(&mut self, dev_buy: u128, tricks: Vec<(u32, u32)>) {
        self.ctx("doggo.handler.testnet", 0);
        let tricks = tricks
            .into_iter()
            .map(|(target_holders, duration_minutes)| TrickInput { target_holders, duration_minutes })
            .collect();
        self.k.launch("dog".into(), "Doggo".into(), "much wow".into(), "".into(), U128(dev_buy), tricks, None)
            .detach();
        self.ctx_with("kennel.testnet", 0, vec![PromiseResult::Successful(vec![])]);
        assert!(self.k.on_launch("dog".into(), U128(0)));
    }

    fn coin(&self) -> Coin {
        self.k.get_coin("dog".into()).unwrap()
    }

    fn bal(&self, who: &str) -> u128 {
        self.k.get_balance("dog".into(), acc(who)).0
    }

    fn agent_balance(&self, who: &str) -> u128 {
        self.k.get_agent(acc(who)).unwrap().balance.0
    }
}

fn set_ctx(now_ms: u64, who: &str, deposit: u128, results: Vec<PromiseResult>) {
    let c = VMContextBuilder::new()
        .current_account_id(acc("kennel.testnet"))
        .predecessor_account_id(acc(who))
        .signer_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now_ms * 1_000_000)
        .account_balance(NearToken::from_near(1_000))
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(c, test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
}

#[test]
fn launch_charges_pup_and_starts_curve() {
    let mut t = T::new();
    let before = t.agent_balance("doggo.handler.testnet");
    t.launch(0, vec![]);
    assert_eq!(t.coin().status, CoinStatus::Curve);
    assert!(t.coin().icon.starts_with("data:image/svg+xml"), "default icon");
    let spent = before - t.agent_balance("doggo.handler.testnet");
    // Token code storage (~1.7 NEAR) + state.
    assert!(spent > near(1) && spent < near(3), "spent {spent}");
}

#[test]
fn sold_out_curve_collects_target_and_graduates() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.wait(5);
    t.as_("whale.testnet", near(15)).k.buy("dog".into(), None, None);
    let c = t.coin();
    assert_eq!(c.status, CoinStatus::Graduating);
    assert_eq!(c.tokens_sold, t.k.get_config().curve_supply);
    let reserve = c.near_reserve.0;
    assert!(reserve.abs_diff(near(10)) < near(1) / 1000, "reserve {reserve}");
    assert!(c.graduation.pool_near.0 < reserve);
}

#[test]
fn buy_sell_roundtrip_loses_only_fees() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.wait(5);
    let tokens = t.as_("alice.testnet", near(1)).k.buy("dog".into(), None, None);
    assert_eq!(t.bal("alice.testnet"), tokens.0);
    let out = t.as_("alice.testnet", 0).k.sell("dog".into(), tokens, None);
    let spent = near(1) - yocto(STORAGE_RESERVE);
    assert!(out.0 < spent && out.0 > spent * 97 / 100, "out {}", out.0);
    assert_eq!(t.bal("alice.testnet"), 0);
    assert!(t.coin().near_reserve.0 < near(1) / 1000);
}

#[test]
fn fees_split_between_creator_and_protocol() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.wait(5);
    let creator_before = t.agent_balance("doggo.handler.testnet");
    t.as_("alice.testnet", near(1) + yocto(STORAGE_RESERVE)).k.buy("dog".into(), None, None);
    let fee = near(1) / 100;
    assert_eq!(t.agent_balance("doggo.handler.testnet") - creator_before, fee / 2);
    assert_eq!(t.k.get_protocol_fees().0, fee - fee / 2);
}

#[test]
#[should_panic(expected = "snipe guard")]
fn snipe_guard_blocks_same_handler() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.as_("rex.handler.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
}

#[test]
fn snipe_guard_allows_others_and_expires() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.as_("luna.other.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
    t.wait(3);
    t.as_("rex.handler.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
    // Same-handler holders never count toward tricks.
    assert_eq!(t.coin().holders, 1);
}

#[test]
fn bull_bark_locks_selling_until_expiry() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.wait(5);
    let tokens = t.as_("luna.other.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
    t.as_("luna.other.testnet", 0).k.bark("dog".into(), Stance::Bull, "to the moon".into(), 60);
    t.wait(50);
    let k = &mut t.as_("luna.other.testnet", 0).k;
    let blocked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        k.sell("dog".into(), tokens, None);
    }));
    assert!(blocked.is_err());
    t.wait(11);
    t.as_("luna.other.testnet", 0).k.sell("dog".into(), tokens, None);
    assert_eq!(t.bal("luna.other.testnet"), 0);
}

#[test]
#[should_panic(expected = "bear bark lock")]
fn bear_bark_blocks_buying() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.as_("luna.other.testnet", 0).k.bark("dog".into(), Stance::Bear, "rug soon".into(), 60);
    t.wait(5);
    t.as_("luna.other.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
}

#[test]
#[should_panic(expected = "lock shorter than minimum")]
fn bark_lock_minimum_enforced() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.as_("luna.other.testnet", 0).k.bark("dog".into(), Stance::Bear, "meh".into(), 59);
}

#[test]
#[should_panic(expected = "bull bark needs a position")]
fn bull_bark_needs_position() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.as_("luna.other.testnet", 0).k.bark("dog".into(), Stance::Bull, "wen".into(), 60);
}

#[test]
fn tricks_unlock_on_target_and_burn_on_deadline() {
    let mut t = T::new();
    t.launch(near(1), vec![(3, 30), (10, 60)]);
    let c = t.coin();
    assert!(c.dev_tokens.0 > 0);
    assert_eq!(t.bal("doggo.handler.testnet"), 0, "dev buy is locked, not spendable");
    let tranche = c.tricks[0].amount.0;
    for h in ["a.testnet", "b.testnet", "c.testnet"] {
        t.as_(h, near(1) / 10).k.buy("dog".into(), None, None);
    }
    assert_eq!(t.coin().holders, 3);
    assert_eq!(t.coin().tricks[0].status, TrickStatus::Passed);
    assert_eq!(t.bal("doggo.handler.testnet"), tranche);

    t.wait(61);
    t.as_("anyone.testnet", 0).k.check_tricks("dog".into());
    let c = t.coin();
    assert_eq!(c.tricks[1].status, TrickStatus::Burned);
    assert_eq!(c.burned, c.tricks[1].amount);
}

#[test]
fn graduation_is_the_final_exam_for_pending_tricks() {
    let mut t = T::new();
    t.launch(near(1), vec![(3, 600)]);
    t.wait(5);
    t.as_("whale.testnet", near(15)).k.buy("dog".into(), None, None);
    let c = t.coin();
    assert_eq!(c.status, CoinStatus::Graduating);
    assert_eq!(c.tricks[0].status, TrickStatus::Burned, "1 holder < 3 at graduation");
}

#[test]
#[should_panic(expected = "a dev buy needs at least one trick")]
fn dev_buy_requires_trick() {
    let mut t = T::new();
    t.launch(near(1), vec![]);
}

#[test]
fn withdraw_goes_to_handler_only() {
    let mut t = T::new();
    let bal = t.agent_balance("doggo.handler.testnet");
    t.as_("handler.testnet", 0).k.withdraw(acc("doggo.handler.testnet"), Some(U128(near(1)))).detach();
    assert_eq!(t.agent_balance("doggo.handler.testnet"), bal - near(1));
    let k = &mut t.as_("doggo.handler.testnet", 0).k;
    let pup_try = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        k.withdraw(acc("doggo.handler.testnet"), None).detach();
    }));
    assert!(pup_try.is_err(), "a pup cannot withdraw its own budget");
}

#[test]
#[should_panic(expected = "pup is paused")]
fn paused_pup_cannot_trade() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.as_("other.testnet", 0).k.pause_agent(acc("luna.other.testnet"));
    t.as_("luna.other.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
}

#[test]
#[should_panic(expected = "pup has not accepted its handler")]
fn foreign_account_must_accept_handler() {
    let mut t = T::new();
    t.as_("handler.testnet", near(5)).k.register_agent(acc("outlayer-wallet.testnet"));
    t.launch(0, vec![]);
    t.as_("outlayer-wallet.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
}

#[test]
fn posts_are_free_events() {
    let mut t = T::new();
    t.launch(0, vec![]);
    let bal = t.agent_balance("doggo.handler.testnet");
    let id = t.as_("doggo.handler.testnet", 0).k.post("dog".into(), "gm".into(), None);
    assert_eq!(t.agent_balance("doggo.handler.testnet"), bal, "posting costs the pup no storage");
    t.as_("luna.other.testnet", 0).k.post("dog".into(), "gm back".into(), Some(id));
    // Humans comment without attaching NEAR.
    let c = t.as_("alice.testnet", 0).k.comment("dog".into(), "lol".into(), None);
    assert_eq!(c, 2);
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs.iter().any(|l| l.contains("\"event\":\"post\"") && l.contains("\"kind\":\"Comment\"")));
    assert_eq!(t.coin().post_count, 3);
}

#[test]
fn bull_bark_binds_the_whole_family() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.wait(5);
    t.as_("luna.other.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
    let max_tokens = t.as_("max.other.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
    let handler_tokens = t.as_("other.testnet", near(1)).k.buy("dog".into(), None, None);
    t.as_("luna.other.testnet", 0).k.bark("dog".into(), Stance::Bull, "lfg".into(), 60);
    let position = format!("\"position\":\"{}\"", t.bal("luna.other.testnet"));
    assert!(near_sdk::test_utils::get_logs().iter().any(|l| l.contains("\"kind\":\"Bark\"") && l.contains(&position)));
    for (who, tokens) in [("max.other.testnet", max_tokens), ("other.testnet", handler_tokens)] {
        let k = &mut t.as_(who, 0).k;
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            k.sell("dog".into(), tokens, None);
        }));
        assert!(r.is_err(), "{who} must not dump while a sibling barks bull");
    }
    // Unrelated holders are unaffected.
    let alice = t.as_("alice.testnet", near(1)).k.buy("dog".into(), None, None);
    t.as_("alice.testnet", 0).k.sell("dog".into(), alice, None);
}

#[test]
#[should_panic(expected = "bear bark lock")]
fn bear_bark_binds_the_whole_family() {
    let mut t = T::new();
    t.launch(0, vec![]);
    t.wait(5);
    t.as_("luna.other.testnet", 0).k.bark("dog".into(), Stance::Bear, "fade".into(), 60);
    t.as_("max.other.testnet", 0).k.buy("dog".into(), Some(U128(near(1))), None);
}

#[test]
fn launch_with_links() {
    let mut t = T::new();
    t.ctx("doggo.handler.testnet", 0);
    let links = Links { website: Some("https://doggo.fun".into()), x: Some("https://x.com/doggo".into()), telegram: None };
    t.k.launch("dog".into(), "Doggo".into(), "".into(), "".into(), U128(0), vec![], Some(links)).detach();
    let l = t.k.get_links("dog".into()).unwrap();
    assert_eq!(l.x.as_deref(), Some("https://x.com/doggo"));
}

#[test]
#[should_panic(expected = "x must start with")]
fn launch_rejects_bad_x_link() {
    let mut t = T::new();
    t.ctx("doggo.handler.testnet", 0);
    let links = Links { website: None, x: Some("javascript:alert(1)".into()), telegram: None };
    t.k.launch("dog".into(), "Doggo".into(), "".into(), "".into(), U128(0), vec![], Some(links)).detach();
}
