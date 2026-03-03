//! SpacetimeDB auth demo module.

use spacetimedb::{reducer, ReducerContext, Table};

#[spacetimedb::table(accessor = user, public)]
pub struct User {
    #[primary_key]
    pub identity: spacetimedb::Identity,
    pub username: Option<String>,
    pub bio: Option<String>,
    pub online: bool,
}

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    let _ = ctx;
}

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
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
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    if let Some(user) = ctx.db.user().identity().find(&ctx.sender()) {
        ctx.db.user().identity().update(User { online: false, ..user });
    }
}

#[reducer]
pub fn set_username(ctx: &ReducerContext, username: String) -> Result<(), String> {
    let username = username.trim().to_string();
    if username.is_empty() {
        return Err("Username must not be empty".to_string());
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
    let bio = bio.trim().to_string();
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
