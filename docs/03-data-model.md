# 03 — 数据模型

## 表清单

| 表 | 用途 | MVP 是否要 |
|----|------|-----------|
| `transactions` | 交易流水，主表 | ✅ |
| `accounts` | 账户（现金/卡/支付宝…） | ✅ |
| `categories` | 分类 | ✅ |
| `budgets` | 预算 | 二期 |
| `recurring_rules` | 固定收支规则 | 二期 |
| `debts` | 借还/应收应付 | 二期 |
| `tags` / `transaction_tags` | 标签 | 二期 |
| `attachments` | 小票图片 | 二期 |
| `app_meta` | schema 版本、设置项、上次备份时间 | ✅ |
| `event_log` | 诊断用日志（环形缓冲，最多保留 500 条） | ✅ |

## 字段定义

### transactions（交易）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT (UUID) | 主键 |
| type | TEXT | `expense` 支出 / `income` 收入 / `transfer` 转账 |
| amount_cents | INTEGER | **金额，单位"分"，永远是正整数**。方向由 type 决定，不用负数 |
| account_id | TEXT | 支出=钱从哪出；收入=钱进哪；转账=转出账户 |
| to_account_id | TEXT | 仅转账用，转入账户 |
| category_id | TEXT | 转账时为空 |
| note | TEXT | 备注 |
| occurred_at | INTEGER | 发生时间戳（毫秒），用户可改日期 |
| created_at / updated_at | INTEGER | 系统时间，用于排查问题 |
| deleted_at | INTEGER | 软删除标记，NULL 表示未删 |
| currency | TEXT | 默认 `CNY`，预留 |
| reimbursement | INTEGER | 0/1，可报销标记（A6） |
| schema_version | INTEGER | 记录创建时的结构版本，方便将来迁移 |

### accounts（账户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id / name / icon / color | TEXT | |
| type | TEXT | `cash` / `debit` / `credit` / `virtual`（支付宝微信）/ `invest` |
| initial_balance_cents | INTEGER | 期初余额，账户余额 = 期初 + 所有流水汇总 |
| credit_limit_cents | INTEGER | 信用卡额度，可空 |
| sort_order | INTEGER | 排序 |
| archived_at | INTEGER | 归档（不显示但保留历史） |
| deleted_at | INTEGER | 软删除 |

### categories（分类）

| 字段 | 类型 | 说明 |
|------|------|------|
| id / name / icon / color | TEXT | |
| kind | TEXT | `expense` / `income` |
| parent_id | TEXT | 二级分类，可空 |
| sort_order | INTEGER | |
| is_system | INTEGER | 系统预置分类不可删 |
| deleted_at | INTEGER | |

## 三条关键设计决策

### 决策 1：金额用整数"分"存，不用小数

`0.1 + 0.2 = 0.30000000000000004` —— 浮点误差在记账 App 里是硬伤，一年累加下来能对不上账。
全部按分存整数，只在显示时除以 100。**这是唯一正确的做法，没有取舍。**

### 决策 2：转账用一条记录，不是两条

```
方案 A（选）：{ type: transfer, from: 银行卡, to: 支付宝, amount: 1000 }
方案 B（弃）：{ type: expense, account: 银行卡, amount: 1000 }   ← 两条
              { type: income,  account: 支付宝, amount: 1000 }
```
方案 B 的问题：统计"本月支出 5000"时，这笔内部转账会被算进去，数字是虚高的。
方案 A 的代价：查询"某账户的所有变动"时要同时查两个字段。这个代价小得多。

### 决策 3：软删除 + schema_version

- 软删除：误删能找回，且诊断面板查"数据完整性"时能看到孤儿数据。
- 每行带 schema_version：将来结构升级时，可以逐行判断需不需要转换，而不是一次性赌整个库。

## 索引

```
transactions: (occurred_at DESC), (account_id, occurred_at), (category_id, occurred_at), (deleted_at)
```
记账 App 的典型查询就是"某月某账户某分类的流水"，这几个索引覆盖 95% 场景。
数据量参考：每天记 5 笔，10 年也就 1.8 万条——**这是个极小的数据库，性能根本不是问题**，别过度设计。
