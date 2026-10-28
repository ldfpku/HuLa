use crate::error::CommonError;
use entity::im_user;
use entity::prelude::ImUserEntity;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, sea_query::Expr,
};
use tracing::{error, info};

/// 更新用户的 is_init 状态
pub async fn update_user_init_status<C>(
    db: &C,
    login_uid: &str,
    is_init: bool,
) -> Result<(), CommonError>
where
    C: ConnectionTrait,
{
    let user_update = im_user::ActiveModel {
        id: Set(login_uid.to_string()),
        is_init: Set(is_init),
        ..Default::default()
    };

    match ImUserEntity::update(user_update).exec(db).await {
        Ok(_) => {
            info!("User {} is_init status updated to {}", login_uid, is_init);
            Ok(())
        }
        Err(e) => {
            error!("Failed to update user is_init status: {:?}", e);
            Err(e.into())
        }
    }
}

/// 保存或更新用户的 token 信息
pub async fn save_user_tokens<C>(
    db: &C,
    login_uid: &str,
    token: &str,
    refresh_token: &str,
) -> Result<(), CommonError>
where
    C: ConnectionTrait,
{
    // 检查用户是否已存在
    let existing_user = ImUserEntity::find()
        .filter(im_user::Column::Id.eq(login_uid))
        .one(db)
        .await
        .map_err(|e| {
            error!("Failed to query user for token update: {:?}", e);
            CommonError::DatabaseError(e)
        })?;

    let refresh_token_to_save = if refresh_token.is_empty() {
        if let Some(user) = &existing_user {
            if let Some(saved_refresh) = user.refresh_token.clone() {
                if !saved_refresh.is_empty() {
                    saved_refresh
                } else {
                    "".to_string()
                }
            } else {
                "".to_string()
            }
        } else {
            "".to_string()
        }
    } else {
        refresh_token.to_string()
    };

    let user_update = if existing_user.is_some() {
        // 用户存在，更新 token 信息
        im_user::ActiveModel {
            id: Set(login_uid.to_string()),
            token: Set(Some(token.to_string())),
            refresh_token: Set(Some(refresh_token_to_save.clone())),
            ..Default::default()
        }
    } else {
        // 用户不存在，创建新用户并设置 token 信息
        im_user::ActiveModel {
            id: Set(login_uid.to_string()),
            token: Set(Some(token.to_string())),
            refresh_token: Set(Some(refresh_token_to_save.clone())),
            is_init: Set(true), // 新用户默认未初始化
            ..Default::default()
        }
    };

    if existing_user.is_some() {
        // 更新现有用户
        match ImUserEntity::update(user_update).exec(db).await {
            Ok(_) => {
                info!("User {} token info updated successfully", login_uid);
                Ok(())
            }
            Err(e) => {
                error!("Failed to update user token info: {:?}", e);
                Err(e.into())
            }
        }
    } else {
        // 插入新用户
        match ImUserEntity::insert(user_update).exec(db).await {
            Ok(_) => {
                info!("New user {} created with token info", login_uid);
                Ok(())
            }
            Err(e) => {
                error!("Failed to create user with token info: {:?}", e);
                Err(e.into())
            }
        }
    }
}

/// 获取用户的 token 信息
pub async fn get_user_tokens<C>(
    db: &C,
    login_uid: &str,
) -> Result<Option<(String, String)>, CommonError>
where
    C: ConnectionTrait,
{
    let user = ImUserEntity::find()
        .filter(im_user::Column::Id.eq(login_uid))
        .one(db)
        .await
        .map_err(|e| {
            error!("Failed to query user tokens: {:?}", e);
            CommonError::DatabaseError(e)
        })?;

    match user {
        Some(user) => {
            if let (Some(token), Some(refresh_token)) = (user.token, user.refresh_token) {
                Ok(Some((token, refresh_token)))
            } else {
                Ok(None)
            }
        }
        None => Ok(None),
    }
}

pub async fn clear_user_tokens<C>(db: &C, login_uid: &str) -> Result<(), CommonError>
where
    C: ConnectionTrait,
{
    ImUserEntity::update_many()
        .col_expr(im_user::Column::Token, Expr::value(None::<String>))
        .col_expr(im_user::Column::RefreshToken, Expr::value(None::<String>))
        .filter(im_user::Column::Id.eq(login_uid))
        .exec(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use migration::{Migrator, MigratorTrait};
    use sea_orm::Database;

    #[tokio::test]
    async fn clear_tokens_only_removes_the_selected_accounts_credentials() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, None).await.unwrap();
        save_user_tokens(&db, "user-1", "access-1", "refresh-1")
            .await
            .unwrap();
        save_user_tokens(&db, "user-2", "access-2", "refresh-2")
            .await
            .unwrap();

        clear_user_tokens(&db, "user-1").await.unwrap();

        assert_eq!(get_user_tokens(&db, "user-1").await.unwrap(), None);
        assert_eq!(
            get_user_tokens(&db, "user-2").await.unwrap(),
            Some(("access-2".to_string(), "refresh-2".to_string()))
        );
    }
}
