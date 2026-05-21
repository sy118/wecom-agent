## 新增需求

### 需求:上下文 TTL 默认值来源
系统必须在创建上下文时使用平台默认会话 TTL 作为未显式指定 `sessionTtlMin` 时的默认值，并保持上下文级 TTL 作为 session 实际生效配置。

#### 场景:上下文未显式配置 TTL
- **当** 创建上下文请求未提供 `sessionTtlMin`
- **那么** 系统必须把平台默认会话 TTL 写入该上下文的 `sessionTtlMin`

#### 场景:上下文已有 TTL 不受平台默认值影响
- **当** 平台默认会话 TTL 发生变化
- **那么** 系统禁止自动修改任何已有上下文的 `sessionTtlMin`

#### 场景:存量 session 不立即重算过期时间
- **当** 平台默认会话 TTL 发生变化
- **那么** 系统禁止立即重算已存在 session 的 `expiresAt`

#### 场景:会话仍使用上下文 TTL 滑动续期
- **当** 某个 chatKey 发来消息且对应上下文已有 `sessionTtlMin`
- **那么** 系统必须继续使用该上下文的 `sessionTtlMin` 计算或刷新 session 的 `expiresAt`

## 修改需求

## 移除需求
