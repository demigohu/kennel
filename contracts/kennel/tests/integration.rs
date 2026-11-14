// End-to-end on a local sandbox with the real Rhea (Ref v1) and wNEAR wasm pulled from
// testnet (tests/res, see tests/res/README.md): register a pup, launch, trade, settle tricks
// (unlock + burn on the token contract), sell out the curve, graduate into a Rhea pool, claim.
//
// Build first: (cd ../token && cargo near build non-reproducible-wasm) && cargo near build non-reproducible-wasm
use near_api::{AccountId, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;

const TGAS300: NearGas = NearGas::from_tgas(300);

struct Env {
    sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
}

impl Env {
    async fn account(&self, name: &str, near: u128) -> testresult::TestResult<AccountId> {
        let id: AccountId = format!("{name}.sandbox").parse()?;
        self.sandbox
            .create_account(id.as_str().parse()?)
            .initial_balance(NearToken::from_near(near))
            .send()
            .await?;
        Ok(id)
    }

    async fn deploy(&self, id: &AccountId, wasm: Vec<u8>, init: &str, args: Value) -> bool {
        near_api::Contract::deploy(id.clone())
            .use_code(wasm)
            .with_init_call(init, args)
            .unwrap()
            .with_signer(self.signer.clone())
            .send_to(&self.net)
            .await
            .map(|r| r.is_success())
            .unwrap_or(false)
    }

    async fn call(&self, who: &AccountId, contract: &AccountId, method: &str, args: Value, deposit: NearToken) -> bool {
        let r = near_api::Contract(contract.clone())
            .call_function(method, args)
            .transaction()
            .gas(TGAS300)
            .deposit(deposit)
            .with_signer(who.clone(), self.signer.clone())
            .send_to(&self.net)
            .await
            .expect("rpc");
        if !r.is_success() {
            eprintln!("{method} failed: {:?}", r);
        }
        r.is_success()
    }

    async fn view(&self, contract: &AccountId, method: &str, args: Value) -> Value {
        near_api::Contract(contract.clone())
            .call_function(method, args)
            .read_only::<Value>()
            .fetch_from(&self.net)
            .await
            .expect("view")
            .data
    }
}

fn near(n: f64) -> NearToken {
    NearToken::from_yoctonear((n * 1e24) as u128)
}

fn u(v: &Value) -> u128 {
    v.as_str().expect("U128 string").parse().unwrap()
}

#[tokio::test]
async fn launch_trade_tricks_graduate_claim() -> testresult::TestResult<()> {
    let kennel_wasm = std::fs::read("target/near/kennel.wasm")
        .expect("build kennel first: cargo near build non-reproducible-wasm");
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;
    let e = Env { sandbox, net, signer };

    let wrap = e.account("wrap", 50).await?;
    let dex = e.account("ref", 50).await?;
    let kennel = e.account("kennel", 50).await?;
    let handler = e.account("handler", 50).await?;
    let pup = e.account("doggo", 5).await?;
    let whale = e.account("whale", 50).await?;
    let holders = [e.account("alice", 5).await?, e.account("bob", 5).await?, e.account("carol", 5).await?];

    assert!(e.deploy(&wrap, std::fs::read("tests/res/wrap.testnet.wasm")?, "new", json!({})).await);
    let ref_wasm = std::fs::read("tests/res/ref-finance-101.testnet.wasm")?;
    let ref_init = json!({"owner_id": dex, "exchange_fee": 4, "referral_fee": 1,
                          "boost_farm_id": dex, "burrowland_id": dex, "wnear_id": wrap});
    assert!(e.deploy(&dex, ref_wasm, "new", ref_init).await, "ref init");

    assert!(
        e.deploy(&kennel, kennel_wasm, "new", json!({
            "treasury": kennel, "dex": dex, "wnear": wrap,
            "graduation_target": near(10.0).as_yoctonear().to_string(),
            "min_bark_lock_minutes": 15, "snipe_guard_minutes": 0,
            "min_trick_minutes": 1, "max_trick_minutes": 10080,
        })).await
    );

    // Non-sub-account pup path: handler registers, pup accepts.
    assert!(e.call(&handler, &kennel, "register_agent", json!({"agent_id": pup}), near(4.5)).await);
    assert!(e.call(&pup, &kennel, "accept_operator", json!({}), NearToken::from_yoctonear(0)).await);

    // Launch with a 0.5 NEAR dev buy split over two tricks.
    assert!(
        e.call(&pup, &kennel, "launch", json!({
            "symbol": "dog", "name": "Doggo", "description": "much wow", "icon": "",
            "dev_buy": near(0.5).as_yoctonear().to_string(),
            "tricks": [{"target_holders": 3, "duration_minutes": 1}, {"target_holders": 50, "duration_minutes": 2}],
        }), NearToken::from_yoctonear(0)).await
    );
    let coin = e.view(&kennel, "get_coin", json!({"symbol": "dog"})).await;
    assert_eq!(coin["status"], "Curve", "{coin}");
    let token: AccountId = coin["token_id"].as_str().unwrap().parse()?;
    let meta = e.view(&token, "ft_metadata", json!({})).await;
    assert_eq!(meta["symbol"], "DOG");
    let supply = u(&e.view(&token, "ft_total_supply", json!({})).await);

    // Three independent holders pass trick 1.
    for h in &holders {
        assert!(e.call(h, &kennel, "buy", json!({"symbol": "dog"}), near(0.2)).await);
    }
    let coin = e.view(&kennel, "get_coin", json!({"symbol": "dog"})).await;
    assert_eq!(coin["tricks"][0]["status"], "Passed", "{coin}");

    // Trick 2 (50 holders in 2 min) expires: its tranche is burned on the token contract.
    e.sandbox.fast_forward(400).await?;
    assert!(e.call(&whale, &kennel, "check_tricks", json!({"symbol": "dog"}), NearToken::from_yoctonear(0)).await);
    let coin = e.view(&kennel, "get_coin", json!({"symbol": "dog"})).await;
    assert_eq!(coin["tricks"][1]["status"], "Burned", "{coin}");
    let burned = u(&coin["burned"]);
    assert!(burned > 0);
    assert_eq!(u(&e.view(&token, "ft_total_supply", json!({})).await), supply - burned);

    // Whale sells out the curve; graduation runs (retry until done).
    assert!(e.call(&whale, &kennel, "buy", json!({"symbol": "dog"}), near(12.0)).await);
    let mut status = String::new();
    for _ in 0..5 {
        let coin = e.view(&kennel, "get_coin", json!({"symbol": "dog"})).await;
        status = coin["status"].as_str().unwrap().to_string();
        if status == "Graduated" {
            break;
        }
        assert_eq!(status, "Graduating", "{coin}");
        eprintln!("graduation state: {}", coin["graduation"]);
        let r = near_api::Contract(kennel.clone())
            .call_function("graduate", json!({"symbol": "dog"}))
            .transaction()
            .gas(TGAS300)
            .with_signer(whale.clone(), e.signer.clone())
            .send_to(&e.net)
            .await?;
        if std::env::var("KENNEL_DEBUG").is_ok() {
            eprintln!("{r:#?}");
        }
    }
    assert_eq!(status, "Graduated");
    let coin = e.view(&kennel, "get_coin", json!({"symbol": "dog"})).await;
    let pool_id = coin["graduation"]["pool_id"].as_u64().unwrap();
    let pool = e.view(&dex, "get_pool", json!({"pool_id": pool_id})).await;
    assert_eq!(pool["token_account_ids"], json!([token, wrap]), "{pool}");
    assert_eq!(u(&pool["amounts"][0]), 200_000_000 * 10u128.pow(18));
    assert_eq!(u(&pool["amounts"][1]), u(&coin["graduation"]["pool_near"]));
    // LP shares sit with kennel, which has no method to move them.
    assert!(u(&e.view(&dex, "get_pool_shares", json!({"pool_id": pool_id, "account_id": kennel})).await) > 0);

    // Claim ledger tokens to a wallet.
    let ledger = u(&e.view(&kennel, "get_balance", json!({"symbol": "dog", "account_id": holders[0]})).await);
    assert!(e.call(&holders[0], &kennel, "claim", json!({"symbol": "dog"}), near(0.00125)).await);
    assert_eq!(u(&e.view(&token, "ft_balance_of", json!({"account_id": holders[0]})).await), ledger);
    Ok(())
}
