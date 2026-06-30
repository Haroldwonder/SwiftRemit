#![cfg(test)]

use crate::{SwiftRemitContract, Role};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_role_storage_and_retrieval() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let admin = Address::generate(&env);
    let settler = Address::generate(&env);

    env.as_contract(&contract_id, || {
        crate::storage::assign_role(&env, &admin, &Role::Admin);
        assert!(crate::storage::has_role(&env, &admin, &Role::Admin));

        crate::storage::assign_role(&env, &settler, &Role::Settler);
        assert!(crate::storage::has_role(&env, &settler, &Role::Settler));

        crate::storage::remove_role(&env, &settler, &Role::Settler);
        assert!(!crate::storage::has_role(&env, &settler, &Role::Settler));
    });
}

#[test]
fn test_role_authorization_checks() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    // Assign Admin role
    env.as_contract(&contract_id, || {
        crate::storage::assign_role(&env, &admin, &Role::Admin);

        assert!(crate::storage::require_role_admin(&env, &admin).is_ok());
        assert!(crate::storage::require_role_admin(&env, &non_admin).is_err());
    });
}

#[test]
fn test_settler_authorization() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let settler = Address::generate(&env);
    let non_settler = Address::generate(&env);

    // Assign Settler role
    env.as_contract(&contract_id, || {
        crate::storage::assign_role(&env, &settler, &Role::Settler);

        assert!(crate::storage::require_role_settler(&env, &settler).is_ok());
        assert!(crate::storage::require_role_settler(&env, &non_settler).is_err());
    });
}

#[test]
fn test_role_persistence() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SwiftRemitContract {});

    let address = Address::generate(&env);

    // Assign role
    env.as_contract(&contract_id, || {
        crate::storage::assign_role(&env, &address, &Role::Admin);

        assert!(crate::storage::has_role(&env, &address, &Role::Admin));
        assert!(crate::storage::has_role(&env, &address, &Role::Admin));
        assert!(crate::storage::has_role(&env, &address, &Role::Admin));
    });
}
