# Review Knowledge Base

Accumulated review patterns from cross-verification sessions.
Patterns are ranked by confidence and frequency.

## High Confidence Patterns

- pattern: Hardcoded seed for risk calculation
  | context: Loss/profit limits calculated against a fixed constant (e.g. `new BigDecimal("1000")`) instead of actual account equity
  | severity: Critical
  | frequency: 1
  | last-seen: 2026-04-13
  | confidence: high
  | source: Both
  | fix: Replace hardcoded seed with `virtualLedgerService.getDailyStartEquity()` or actual balance. Apply to all loss/profit threshold methods.
  | reason: Risk limits become detached from real capital, causing either over-exposure or unnecessary throttling as account grows/shrinks.

- pattern: Bias flip branch structure mismatch
  | context: Sequential if blocks (not else-if) handling direction changes allow fall-through where SL protection set in one branch can be silently overridden or contradicted by a later branch
  | severity: Critical
  | frequency: 1
  | last-seen: 2026-04-13
  | confidence: high
  | source: Both
  | fix: Convert sequential if blocks to explicit else-if chain. Add ratchet guard preventing SL from moving to a less favorable value.
  | reason: Intended "RANGE = less aggressive" policy is not enforced; loss positions get unintended BE stops.

- pattern: Null-unsafe trailing price access
  | context: Trailing stop logic calls `trade.getHighestPrice()` or `trade.getLowestPrice()` without null guard on one direction while the opposite direction is null-safe
  | severity: Critical
  | frequency: 1
  | last-seen: 2026-04-13
  | confidence: high
  | source: Both
  | fix: Add null initialization guard at method entry for both highestPrice (BUY) and lowestPrice (SELL) before any compareTo call.
  | reason: NPE kills the entire real-time position management thread, leaving open positions unmanaged.

- pattern: Stub unlock condition in consecutive-loss lock
  | context: Method documentation lists an unlock condition (e.g. "bias flip since lock time") but the code path is a no-op that always returns true/false without checking the actual condition
  | severity: Major
  | frequency: 1
  | last-seen: 2026-04-13
  | confidence: high
  | source: Both
  | fix: Store the bias direction at lock time and compare against current direction to detect actual flip. Only then unlock.
  | reason: Symbols can remain permanently locked, over-throttling the strategy, or always unlocked, defeating the safety mechanism.

## Pending Verification

- pattern: Non-idempotent bar event processing
  | context: Strategy evaluate() mutates internal state (pendingIntents) before shouldExecute() checks for duplicate bars, allowing duplicate/concurrent bar events to produce duplicate orders
  | severity: Critical
  | frequency: 1
  | last-seen: 2026-04-13
  | confidence: pending
  | source: Codex
  | fix: Move shouldExecute() / duplicate-bar guard before evaluate() call, or make evaluate() side-effect-free until execution is confirmed.
  | reason: Concurrent bar events from WebSocket can produce duplicate orders leading to unintended position doubling.

- pattern: Scale-in without live order submission
  | context: Scaling entry (2nd tranche) modifies TradeLog fields (entryPrice, quantity, fee) locally and saves to DB, but does not submit an actual exchange order in live mode
  | severity: Critical
  | frequency: 1
  | last-seen: 2026-04-13
  | confidence: pending
  | source: Codex
  | fix: Route scale-in through the same order submission path used for initial entries. Ensure VirtualLedgerService tracks the additional margin.
  | reason: Live exchange position and local state diverge immediately, corrupting all subsequent P&L and risk calculations.

- pattern: Flash crash detection based on entry-price delta
  | context: Flash crash detector uses abs(currentPrice - entryPrice) / entryPrice, which triggers on normal favorable trends (e.g. +7% profit) as well as actual crashes
  | severity: Critical
  | frequency: 1
  | last-seen: 2026-04-13
  | confidence: pending
  | source: Codex
  | fix: Use directional check (only trigger on adverse moves) and/or time-windowed price change from market data instead of entry-price delta.
  | reason: Profitable positions are force-closed repeatedly, turning winning trades into unnecessary exits.

- pattern: Thread-unsafe shared mutable fields in Spring singleton
  | context: Mutable fields (long counter, BigDecimal reference) in a @Service/@Component bean are read/written from multiple WebSocket threads without volatile/Atomic/synchronized
  | severity: Critical
  | frequency: 1
  | last-seen: 2026-04-13
  | confidence: pending
  | source: Claude
  | fix: Use AtomicLong for counters and volatile for reference fields accessed cross-thread. Or synchronize the critical section.
  | reason: Data races cause stale reads; e.g. BTC Shield activation invisible to other threads, allowing trades that should be blocked.

- pattern: Indicator object recreation per call in helper
  | context: Technical indicator helper creates new Indicator instances (IchimokuTenkanSenIndicator etc.) on every method call instead of caching, causing O(period * barCount) recalculation each time
  | severity: Critical
  | frequency: 1
  | last-seen: 2026-04-13
  | confidence: pending
  | source: Claude
  | fix: Cache indicator instances keyed by BarSeries identity/endIndex, or compute all values in a single calculateAll() pass.
  | reason: Compound calls (checkTrendDirection) create 20+ indicator objects per invocation; becomes a bottleneck as symbol count grows.
