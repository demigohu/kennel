// NEP-141 token for one Kennel litter, deployed by kennel at launch. The whole supply is
// minted to kennel. While the coin is on the bonding curve, the token is "leashed": holders
// own real tokens in their wallets, but only kennel can move them (curve buys and sells),
// so bark locks and holder counts cannot be dodged by shuffling tokens between accounts.
// Kennel calls `unlock` at graduation and from then on it is a plain NEP-141.
use near_contract_standards::fungible_token::events::FtBurn;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue, env, near, require,
};

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Token,
    Metadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    /// True while the coin trades on Kennel's curve.
    leashed: bool,
}

#[near]
impl Contract {
    /// `register` pre-registers accounts (e.g. the DEX) so kennel can transfer to them later.
    #[init]
    pub fn new(
        owner_id: AccountId,
        total_supply: U128,
        metadata: FungibleTokenMetadata,
        register: Vec<AccountId>,
    ) -> Self {
        metadata.assert_valid();
        let mut this = Self {
            owner_id: owner_id.clone(),
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            leashed: true,
        };
        this.token.internal_register_account(&owner_id);
        for account in register {
            if account != owner_id {
                this.token.internal_register_account(&account);
            }
        }
        this.token.internal_deposit(&owner_id, total_supply.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &owner_id,
            amount: total_supply,
            memo: Some("kennel launch"),
        }
        .emit();
        this
    }

    /// Curve trade settlement by kennel: buys move owner -> buyer, sells buyer -> owner.
    /// New holders are registered from this account's balance (funded at launch).
    pub fn kennel_move(&mut self, from: AccountId, to: AccountId, amount: U128) {
        self.assert_owner();
        if !self.token.accounts.contains_key(&to) {
            self.token.internal_register_account(&to);
        }
        self.token.internal_transfer(&from, &to, amount.0, Some("kennel curve".into()));
    }

    /// Called by kennel at graduation: the token becomes freely transferable.
    pub fn unlock(&mut self) {
        self.assert_owner();
        self.leashed = false;
    }

    pub fn is_leashed(&self) -> bool {
        self.leashed
    }

    /// Burn tokens held by the owner (kennel). Used when a trick fails.
    pub fn burn(&mut self, amount: U128) {
        self.assert_owner();
        self.token.internal_withdraw(&self.owner_id, amount.0);
        FtBurn {
            owner_id: &self.owner_id,
            amount,
            memo: Some("kennel trick failed"),
        }
        .emit();
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "only owner");
    }

    fn assert_unleashed(&self) {
        require!(
            !self.leashed || env::predecessor_account_id() == self.owner_id,
            "leashed: transfers open when the coin graduates; trade on Kennel until then"
        );
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.assert_unleashed();
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.assert_unleashed();
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, _burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_contract_standards::fungible_token::metadata::FT_METADATA_SPEC;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

    fn meta() -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Doggo".into(),
            symbol: "DOGGO".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 18,
        }
    }

    #[test]
    fn mint_register_burn() {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(0)).build());
        let mut c = Contract::new(accounts(0), U128(1000), meta(), vec![accounts(1)]);
        assert_eq!(c.ft_balance_of(accounts(0)).0, 1000);
        assert!(c.storage_balance_of(accounts(1)).is_some());
        c.burn(U128(400));
        assert_eq!(c.ft_total_supply().0, 600);
    }

    #[test]
    fn leashed_until_unlock() {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(0)).build());
        let mut c = Contract::new(accounts(0), U128(1000), meta(), vec![]);
        c.kennel_move(accounts(0), accounts(1), U128(100));
        assert_eq!(c.ft_balance_of(accounts(1)).0, 100);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(accounts(1)).attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        let blocked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.ft_transfer(accounts(2), U128(10), None);
        }));
        assert!(blocked.is_err(), "holders cannot transfer while leashed");
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(0)).build());
        c.kennel_move(accounts(1), accounts(0), U128(40));
        c.unlock();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(accounts(1)).attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(0)).build());
        c.kennel_move(accounts(0), accounts(2), U128(1));
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(accounts(1)).attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(ctx.build());
        c.ft_transfer(accounts(2), U128(10), None);
        assert_eq!(c.ft_balance_of(accounts(1)).0, 50);
    }

    #[test]
    #[should_panic(expected = "only owner")]
    fn kennel_move_only_owner() {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(0)).build());
        let mut c = Contract::new(accounts(0), U128(1000), meta(), vec![]);
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(1)).build());
        c.kennel_move(accounts(0), accounts(1), U128(1));
    }

    #[test]
    #[should_panic(expected = "only owner")]
    fn burn_only_owner() {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(0)).build());
        let mut c = Contract::new(accounts(0), U128(1000), meta(), vec![]);
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(1)).build());
        c.burn(U128(1));
    }
}
