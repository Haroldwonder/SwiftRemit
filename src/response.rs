use soroban_sdk::contracttype;

/// Standardized response wrapper for query operations.
/// Provides consistent structure for off-chain integrations.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Response<T: Clone> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<u32>,
    pub request_id: soroban_sdk::String,
}

impl<T: Clone> Response<T> {
    pub fn ok(data: T, request_id: soroban_sdk::String) -> Self {
        Response {
            success: true,
            data: Some(data),
            error: None,
            request_id,
        }
    }

    pub fn err(error_code: u32, request_id: soroban_sdk::String) -> Self {
        Response {
            success: false,
            data: None,
            error: Some(error_code),
            request_id,
        }
    }
}
