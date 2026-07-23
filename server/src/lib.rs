//! SpacetimeDB auth demo module.

use spacetimedb::{reducer, ConnectionId, Query, ReducerContext, Table, ViewContext};

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

fn require_application_jwt(ctx: &ReducerContext) -> Result<(), String> {
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
    Ok(())
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
    require_application_jwt(ctx)?;
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
    }
    let still_online = ctx
        .db
        .authenticated_connection()
        .identity()
        .filter(&ctx.sender())
        .next()
        .is_some();
    if let Some(user) = ctx.db.user().identity().find(&ctx.sender()) {
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
