//! Idempotency storage for transfer requests.
//!
//! Provides persistence helpers so that retried transfer requests carrying the
//! same idempotency key do not create duplicate remittances. The stored record
//! captures the original request fingerprint and the resulting response so a
//! replay can be answered without re-executing the transfer.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

/// A persisted idempotency record keyed by the client-supplied idempotency key.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct IdempotencyRecord {
    /// The client-supplied idempotency key.
    pub idempotency_key: String,
    /// Fingerprint of the original request payload, used to detect key reuse
    /// with a different body.
    pub request_hash: String,
    /// Serialized response returned for the original request.
    pub response_body: serde_json::Value,
    /// HTTP status code of the original response.
    pub status_code: i32,
    /// When the record was first created.
    pub created_at: DateTime<Utc>,
    /// When the record expires and may be purged.
    pub expires_at: DateTime<Utc>,
}

/// Outcome of attempting to reserve an idempotency key.
#[derive(Debug, Clone)]
pub enum IdempotencyOutcome {
    /// The key was newly reserved; the caller should execute the operation.
    Reserved,
    /// The key already exists with a matching request fingerprint; the stored
    /// response should be replayed.
    Replay(IdempotencyRecord),
    /// The key already exists but was used with a different request payload.
    Conflict,
}

/// Errors returned by the idempotency storage layer.
#[derive(Debug, thiserror::Error)]
pub enum IdempotencyError {
    #[error("idempotency key already in use with a different request")]
    Conflict,
    #[error("idempotency storage error: {0}")]
    Storage(#[from] sqlx::Error),
}

/// Attempts to reserve an idempotency key for a new operation.
///
/// Returns [`IdempotencyOutcome::Reserved`] when the key is free (or an expired
/// record was replaced), [`IdempotencyOutcome::Replay`] when a completed record
/// with the same request fingerprint exists, and [`IdempotencyOutcome::Conflict`]
/// when the key was previously used with a different payload.
pub async fn reserve_idempotency_key(
    pool: &PgPool,
    idempotency_key: &str,
    request_hash: &str,
    ttl_seconds: i64,
) -> Result<IdempotencyOutcome, IdempotencyError> {
    let existing = get_idempotency_record(pool, idempotency_key).await?;

    if let Some(record) = existing {
        if record.expires_at > Utc::now() {
            if record.request_hash == request_hash {
                return Ok(IdempotencyOutcome::Replay(record));
            }
            return Ok(IdempotencyOutcome::Conflict);
        }
        // Expired record: remove it so the key can be reused.
        delete_idempotency_record(pool, idempotency_key).await?;
    }

    let expires_at = Utc::now() + chrono::Duration::seconds(ttl_seconds);
    sqlx::query(
        r#"
        INSERT INTO idempotency_keys (idempotency_key, request_hash, response_body, status_code, created_at, expires_at)
        VALUES ($1, $2, '{}'::jsonb, 0, NOW(), $3)
        "#,
    )
    .bind(idempotency_key)
    .bind(request_hash)
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(IdempotencyOutcome::Reserved)
}

/// Persists the response produced for a previously reserved idempotency key.
pub async fn store_idempotency_response(
    pool: &PgPool,
    idempotency_key: &str,
    response_body: &serde_json::Value,
    status_code: i32,
) -> Result<(), IdempotencyError> {
    sqlx::query(
        r#"
        UPDATE idempotency_keys
        SET response_body = $2, status_code = $3
        WHERE idempotency_key = $1
        "#,
    )
    .bind(idempotency_key)
    .bind(response_body)
    .bind(status_code)
    .execute(pool)
    .await?;

    Ok(())
}

/// Fetches an idempotency record by key, if present.
pub async fn get_idempotency_record(
    pool: &PgPool,
    idempotency_key: &str,
) -> Result<Option<IdempotencyRecord>, IdempotencyError> {
    let record = sqlx::query_as::<_, IdempotencyRecord>(
        r#"
        SELECT idempotency_key, request_hash, response_body, status_code, created_at, expires_at
        FROM idempotency_keys
        WHERE idempotency_key = $1
        "#,
    )
    .bind(idempotency_key)
    .fetch_optional(pool)
    .await?;

    Ok(record)
}

/// Deletes an idempotency record by key.
pub async fn delete_idempotency_record(
    pool: &PgPool,
    idempotency_key: &str,
) -> Result<(), IdempotencyError> {
    sqlx::query("DELETE FROM idempotency_keys WHERE idempotency_key = $1")
        .bind(idempotency_key)
        .execute(pool)
        .await?;

    Ok(())
}

/// Removes all expired idempotency records and returns the number purged.
pub async fn purge_expired_idempotency_records(pool: &PgPool) -> Result<u64, IdempotencyError> {
    let result = sqlx::query("DELETE FROM idempotency_keys WHERE expires_at <= NOW()")
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

/// Computes a stable fingerprint for a transfer request payload.
///
/// Used to detect idempotency key reuse with a different request body.
pub fn compute_request_hash<T: Serialize>(payload: &T) -> Result<String, serde_json::Error> {
    let canonical = serde_json::to_string(payload)?;
    Ok(format!("{:x}", md5::compute(canonical.as_bytes())))
}

/// Convenience wrapper that reserves a key for a remittance creation request.
///
/// Returns the [`IdempotencyOutcome`] so `create_remittance` can either proceed
/// with the transfer or replay the stored response instead of creating a
/// duplicate remittance.
pub async fn check_remittance_idempotency(
    pool: &PgPool,
    idempotency_key: &str,
    request_hash: &str,
    ttl_seconds: i64,
) -> Result<IdempotencyOutcome, IdempotencyError> {
    reserve_idempotency_key(pool, idempotency_key, request_hash, ttl_seconds).await
}

/// Generates a fresh idempotency key when a client does not supply one.
pub fn generate_idempotency_key() -> String {
    Uuid::new_v4().to_string()
}
