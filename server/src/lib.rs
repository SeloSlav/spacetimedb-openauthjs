//! SpacetimeDB auth demo module.

use spacetimedb::{
    reducer, ConnectionId, Query, ReducerContext, ScheduleAt, Table, Timestamp, ViewContext,
};

const EXPECTED_ISSUER: &str = match option_env!("AUTH_ISSUER_URL") {
    Some(value) => value,
    None => "http://localhost:4001",
};
const EXPECTED_AUDIENCE: &str = match option_env!("AUTH_CLIENT_ID") {
    Some(value) => value,
    None => "vibe-survival-game-client",
};
const MAX_USERNAME_CHARS: usize = 32;
const MAX_BIO_CHARS: usize = 500;

fn require_application_jwt(ctx: &ReducerContext) -> Result<Timestamp, String> {
    let jwt = ctx
        .sender_auth()
        .jwt()
        .ok_or_else(|| "Authentication required".to_string())?;

    if jwt.issuer() != EXPECTED_ISSUER {
        return Err("Invalid authentication issuer".to_string());
    }
    if !jwt
        .audience()
        .iter()
        .any(|audience| audience == EXPECTED_AUDIENCE)
    {
        return Err("Invalid authentication audience".to_string());
    }
    let claims: serde_json::Value = serde_json::from_str(jwt.raw_payload())
        .map_err(|_| "Invalid authentication claims".to_string())?;
    if claims.get("token_use").and_then(serde_json::Value::as_str) != Some("id") {
        return Err("Invalid authentication token type".to_string());
    }
    if claims
        .get("email_verified")
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return Err("Verified email required".to_string());
    }
    let expires_at_seconds = claims
        .get("exp")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "Missing authentication expiry".to_string())?;
    let expires_at_micros = expires_at_seconds
        .checked_mul(1_000_000)
        .ok_or_else(|| "Invalid authentication expiry".to_string())?;
    let expires_at = Timestamp::from_micros_since_unix_epoch(expires_at_micros);
    if expires_at <= ctx.timestamp {
        return Err("Authentication token expired".to_string());
    }
    Ok(expires_at)
}

#[spacetimedb::table(accessor = user)]
pub struct User {
    #[primary_key]
    pub identity: spacetimedb::Identity,
    pub username: Option<String>,
    pub bio: Option<String>,
    #[index(btree)]
    pub online: bool,
}

#[spacetimedb::table(accessor = authenticated_connection)]
pub struct AuthenticatedConnection {
    #[primary_key]
    pub connection_id: ConnectionId,
    #[index(btree)]
    pub identity: spacetimedb::Identity,
    #[index(btree)]
    pub allowed: bool,
}

#[spacetimedb::table(
    accessor = authenticated_connection_expiry,
    scheduled(expire_authenticated_connection)
)]
pub struct AuthenticatedConnectionExpiry {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    #[index(btree)]
    pub connection_id: ConnectionId,
    pub identity: spacetimedb::Identity,
}

/// Expose only online users, and only while the caller has a connection that
/// passed the JWT issuer/audience checks. The backing tables remain private.
#[spacetimedb::view(accessor = authenticated_user_directory, public)]
pub fn authenticated_user_directory(ctx: &ViewContext) -> impl Query<User> {
    ctx.from
        .authenticated_connection()
        .r#where(|connection| connection.identity.eq(ctx.sender()))
        .right_semijoin(ctx.from.user(), |connection, user| {
            connection.allowed.eq(user.online)
        })
        .r#where(|user| user.online.eq(true))
        .build()
}

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    let _ = ctx;
}

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) -> Result<(), String> {
    let expires_at = require_application_jwt(ctx)?;
    let connection_id = ctx
        .connection_id()
        .ok_or_else(|| "Connection context required".to_string())?;
    ctx.db
        .authenticated_connection()
        .insert(AuthenticatedConnection {
            connection_id,
            identity: ctx.sender(),
            allowed: true,
        });
    ctx.db
        .authenticated_connection_expiry()
        .insert(AuthenticatedConnectionExpiry {
            scheduled_id: 0,
            scheduled_at: expires_at.into(),
            connection_id,
            identity: ctx.sender(),
        });
    if let Some(user) = ctx.db.user().identity().find(&ctx.sender()) {
        ctx.db.user().identity().update(User { online: true, ..user });
    } else {
        ctx.db.user().insert(User {
            identity: ctx.sender(),
            username: None,
            bio: None,
            online: true,
        });
    }
    Ok(())
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    if let Some(connection_id) = ctx.connection_id() {
        ctx.db
            .authenticated_connection()
            .connection_id()
            .delete(&connection_id);
        ctx.db
            .authenticated_connection_expiry()
            .connection_id()
            .delete(&connection_id);
    }
    update_online_status(ctx, ctx.sender());
}

#[reducer]
pub fn expire_authenticated_connection(
    ctx: &ReducerContext,
    expiry: AuthenticatedConnectionExpiry,
) -> Result<(), String> {
    if ctx.sender() != ctx.identity() {
        return Err("Only the scheduler may expire authenticated connections".to_string());
    }
    ctx.db
        .authenticated_connection()
        .connection_id()
        .delete(&expiry.connection_id);
    update_online_status(ctx, expiry.identity);
    Ok(())
}

fn update_online_status(ctx: &ReducerContext, identity: spacetimedb::Identity) {
    let still_online = ctx
        .db
        .authenticated_connection()
        .identity()
        .filter(&identity)
        .next()
        .is_some();
    if let Some(user) = ctx.db.user().identity().find(&identity) {
        ctx.db.user().identity().update(User {
            online: still_online,
            ..user
        });
    }
}

#[reducer]
pub fn set_username(ctx: &ReducerContext, username: String) -> Result<(), String> {
    require_application_jwt(ctx)?;
    let username = username.trim().to_string();
    if username.is_empty() {
        return Err("Username must not be empty".to_string());
    }
    if username.chars().count() > MAX_USERNAME_CHARS {
        return Err(format!(
            "Username must be at most {MAX_USERNAME_CHARS} characters"
        ));
    }
    if username.chars().any(char::is_control) {
        return Err("Username must not contain control characters".to_string());
    }
    if let Some(user) = ctx.db.user().identity().find(&ctx.sender()) {
        ctx.db.user().identity().update(User {
            username: Some(username),
            ..user
        });
        Ok(())
    } else {
        Err("User not found".to_string())
    }
}

#[reducer]
pub fn set_bio(ctx: &ReducerContext, bio: String) -> Result<(), String> {
    require_application_jwt(ctx)?;
    let bio = bio.trim().to_string();
    if bio.chars().count() > MAX_BIO_CHARS {
        return Err(format!("Bio must be at most {MAX_BIO_CHARS} characters"));
    }
    if bio
        .chars()
        .any(|character| character.is_control() && character != '\n' && character != '\r' && character != '\t')
    {
        return Err("Bio contains unsupported control characters".to_string());
    }
    if let Some(user) = ctx.db.user().identity().find(&ctx.sender()) {
        ctx.db.user().identity().update(User {
            bio: if bio.is_empty() { None } else { Some(bio) },
            ..user
        });
        Ok(())
    } else {
        Err("User not found".to_string())
    }
}
