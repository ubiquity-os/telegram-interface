# Logging System & Autonomous Debugging Guide

## Overview

The Telegram Interface Bot features a sophisticated rotating log system designed for autonomous debugging and system monitoring. This system provides comprehensive observability into system behavior, enabling effective troubleshooting and performance analysis without external dependencies.

## A. Logging System Overview

### Console Override Mechanism

The logging system implements a **console override pattern** that captures all console output to both the terminal AND log files simultaneously:

```typescript
// Located at: src/utils/log-manager.ts
console.log = createConsoleWrapper(originalConsole.log, 'log');
console.error = createConsoleWrapper(originalConsole.error, 'error');
console.warn = createConsoleWrapper(originalConsole.warn, 'warn');
console.info = createConsoleWrapper(originalConsole.info, 'info');
```

**Key Features:**
- **Dual Output**: All console methods write to both terminal and `logs/latest.log`
- **Format Preservation**: Object serialization maintains data structure in logs
- **Non-blocking**: Asynchronous file writes prevent performance impact
- **Error Safety**: Log write failures don't crash the system

### Log Rotation Behavior

The system implements **automatic log rotation** with session-based file naming and enhanced tracing:

**Rotation Triggers:**
- System startup (`src/main.ts` and `src/core/start-api-server.ts`)
- New message processing sessions (`src/core/message-router.ts`)

**Session-Based Filename Format:**
```typescript
const timestamp = Math.floor(Date.now() / 1000); // POSIX timestamp
const sessionSuffix = generateSessionSuffix(); // e.g., "82j2ofsla"
const rotatedFile = `logs/${timestamp}-${sessionSuffix}.log`;
```

**Rotation Process:**
1. Check if `logs/latest.log` exists
2. Generate POSIX timestamp and session suffix for current session
3. Move `latest.log` → `logs/[timestamp]-[sessionSuffix].log`
4. Create new `latest.log` for current session
5. **Backward Compatibility**: Falls back to `logs/[timestamp].log` if session suffix unavailable

### File Structure and Organization

```
logs/
├── latest.log                    # Current session log (active)
├── 1751026088631-82j2ofsla.log  # Session with suffix (enhanced tracing)
├── 1751026753.log               # Fallback without session (backward compatibility)
├── 1751012156.log               # Earlier session (timestamp only)
└── 1751012173-x8ka9dfj.log      # Historical session with suffix
```

**File Descriptions:**
- **`latest.log`**: Active logging for current session - real-time debugging
- **`[timestamp]-[sessionSuffix].log`**: Session-based logs with enhanced correlation capabilities
- **`[timestamp].log`**: Backward compatible logs without session suffix
- **Session Suffixes**: Random alphanumeric strings for unique session identification
- **Timestamps**: POSIX format for chronological ordering and easy parsing

### Integration Points

**Primary Integration Locations:**
1. **System Bootstrap** ([`src/main.ts:22`](src/main.ts:22))
   ```typescript
   await initializeLogging();
   ```

2. **API Server Startup** ([`src/core/start-api-server.ts:22`](src/core/start-api-server.ts:22))
   ```typescript
   await initializeLogging();
   ```

3. **Message Processing** ([`src/core/message-router.ts:75`](src/core/message-router.ts:75))
   ```typescript
   const rotatedFile = await rotateLog();
   ```

## B. Autonomous Debugging Guide

### Reading Current Session Logs

**Primary Debugging File: `logs/latest.log`**

```bash
# Monitor real-time logging
tail -f logs/latest.log

# Search for specific patterns
grep -i "error\|warn\|failed" logs/latest.log

# View recent entries
tail -n 50 logs/latest.log
```

### Log Entry Format

Each log entry follows this structure:
```
[2025-06-27T08:18:08.544Z] [LEVEL] [Component] Message content
```

**Example Entries:**
```
[2025-06-27T08:18:08.544Z] [LOG] [SystemOrchestrator] Processing text message: "test"
[2025-06-27T08:18:08.545Z] [LOG] [MessagePreProcessor] STARTING LLM ANALYSIS for message: "test"
[2025-06-27T08:18:08.548Z] [ERROR] [MCPClient] Connection failed: timeout after 5000ms
```

### Key Log Patterns and Markers

#### 1. System Flow Indicators
```bash
# System startup sequence
grep "Initializing logging system" logs/latest.log
grep "System Orchestrator initialized" logs/latest.log
grep "Bootstrap" logs/latest.log

# Message processing flow
grep "Processing text message" logs/latest.log
grep "STARTING LLM ANALYSIS" logs/latest.log
grep "Generated response" logs/latest.log
```

#### 2. Error Patterns
```bash
# Critical errors
grep -i "\[ERROR\]" logs/latest.log

# Warning patterns
grep -i "\[WARN\]" logs/latest.log

# Failed operations
grep -i "failed\|timeout\|error" logs/latest.log
```

#### 3. Performance Indicators
```bash
# Response timing
grep -i "processing.*ms\|response.*time" logs/latest.log

# Cache performance
grep -i "cache.*hit\|cache.*miss" logs/latest.log

# Connection status
grep -i "connection.*pool\|mcp.*connected" logs/latest.log
```

#### 4. Session Markers
```bash
# Log rotation events
grep "Rotated log to:" logs/latest.log

# Session boundaries
grep "=== ORCHESTRATOR CALLED ===" logs/latest.log

# Request identifiers
grep "req_[0-9]" logs/latest.log
```

### Historical Analysis with Session-Based Logs

**Examining Previous Sessions:**
```bash
# List all log files chronologically (including session suffixes)
ls -la logs/*.log | sort

# Analyze specific session with suffix
cat logs/1751026088631-82j2ofsla.log | grep -i "error"

# Find logs for specific session suffix
ls logs/*-82j2ofsla.log

# Compare sessions (session-based vs timestamp-only)
diff logs/1751026088631-82j2ofsla.log logs/1751026753.log

# Search across multiple sessions
grep -i "pattern" logs/*.log

# Find all sessions with suffixes
ls logs/*-*.log

# Find all fallback sessions (timestamp only)
ls logs/[0-9]*.log | grep -v "\-"
```

**Session Correlation Examples:**
```bash
# Correlate CLI session with log files
grep "session_1751026088631_82j2ofsla" logs/latest.log
ls logs/1751026088631-82j2ofsla.log

# Find sessions by time range
ls logs/175102[6-7]*.log

# Session pattern analysis
grep -o "\-[a-z0-9]*\.log" logs/*.log | sort | uniq -c
```

## C. Testing & Debugging with cURL

### Core API Endpoints

The system exposes REST endpoints for testing and debugging:

#### 1. Message Processing Endpoint

**Test Basic Message Processing:**
```bash
curl -X POST http://localhost:8000/api/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "text": "Hello, test message"
    }
  }'
```

**Expected Log Patterns:**
```
[LOG] [SystemOrchestrator] Processing text message: "Hello, test message"
[LOG] [MessagePreProcessor] STARTING LLM ANALYSIS for message: "Hello, test message"
[LOG] [LLMService] Making request to OpenRouter
[LOG] [ResponseGenerator] Generated response: "..."
```

#### 2. Health Check Endpoint

**System Health Verification:**
```bash
curl -X GET http://localhost:8000/api/v1/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-06-27T08:18:08.544Z",
  "uptime": 12345,
  "components": {
    "messageQueue": "operational",
    "connectionPool": "healthy",
    "contextCache": "active"
  }
}
```

**Expected Log Patterns:**
```
[LOG] [CoreApiServer] Health check requested
[LOG] [SystemOrchestrator] Component health verified
```

#### 3. Session Management

**Create New Session:**
```bash
curl -X POST http://localhost:8000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "rest_api",
    "userId": "test_user_123"
  }'
```

**Get Session Details:**
```bash
curl -X GET "http://localhost:8000/api/v1/sessions/test_session_id"
```

#### 4. Available Tools Endpoint

**List Available MCP Tools:**
```bash
curl -X GET http://localhost:8000/api/v1/tools
```

**Expected Log Patterns:**
```
[LOG] [MCPToolManager] Listing available tools
[LOG] [MCPClient] Connected to server: weather-server
[LOG] [ToolRegistry] Retrieved 15 tools from 3 servers
```

### Error Condition Testing

#### 1. Invalid Message Format
```bash
curl -X POST http://localhost:8000/api/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"invalid": "payload"}'
```

**Expected Log Patterns:**
```
[ERROR] [MessageRouter] Invalid message format: missing required fields
[WARN] [ErrorHandler] Validation failed for request req_...
```

#### 2. Missing Content-Type
```bash
curl -X POST http://localhost:8000/api/v1/messages \
  -d '{"message": {"text": "test"}}'
```

**Expected Log Patterns:**
```
[ERROR] [CoreApiServer] Invalid Content-Type header
[WARN] [RequestValidator] Content-Type validation failed
```

#### 3. Large Message Testing
```bash
curl -X POST http://localhost:8000/api/v1/messages \
  -H "Content-Type: application/json" \
  -d "{\"message\": {\"text\": \"$(python3 -c 'print("A" * 10000)')\"}}"
```

**Expected Log Patterns:**
```
[WARN] [MessagePreProcessor] Message exceeds recommended length: 10000 chars
[LOG] [LLMService] Truncating context to fit token limits
```

### Log Correlation Techniques

#### Session-Based Debugging Capabilities

**Enhanced Session Tracing:**
The session-based log rotation provides superior debugging capabilities:

```bash
# Find logs for specific session
ls logs/*-82j2ofsla.log

# Correlate CLI session with log files
grep "session_1751026088631_82j2ofsla" logs/latest.log
ls logs/1751026088631-82j2ofsla.log

# Session timeline analysis
ls -lt logs/*-82j2ofsla.log | head -10

# Cross-session comparison for debugging patterns
diff <(grep -i "error" logs/1751026088631-82j2ofsla.log) \
     <(grep -i "error" logs/1751026753.log)
```

#### Correlating cURL Requests with Logs

**1. Request Tracking:**
Each request generates a unique identifier visible in logs:
```bash
# Make request and note timestamp
curl -X POST http://localhost:8000/api/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"message": {"text": "track this request"}}'

# Find corresponding log entries (session-aware)
grep "track this request" logs/latest.log
grep "$(date +%Y-%m-%d)" logs/latest.log | grep "track this request" -A 5 -B 5

# Check for session correlation
CURRENT_SESSION=$(ls -t logs/*-*.log | head -1 | sed 's/.*-\(.*\)\.log/\1/')
echo "Current session: $CURRENT_SESSION"
grep "track this request" logs/*-${CURRENT_SESSION}.log
```

**2. Error Correlation:**
```bash
# Generate error condition
curl -X POST http://localhost:8000/api/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"invalid": "data"}'

# Immediately check logs for errors
tail -n 20 logs/latest.log | grep -i "error\|warn"
```

**3. Performance Analysis:**
```bash
# Send request and measure response time
time curl -X POST http://localhost:8000/api/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"message": {"text": "performance test"}}'

# Check corresponding processing times in logs
grep "performance test" logs/latest.log | grep -i "time\|ms\|duration"
```

## D. Debugging Workflow Examples

### 1. Message Processing Debugging

**Scenario:** User reports bot not responding to messages

**Step-by-Step Debugging with Session Awareness:**

```bash
# 1. Check if system is receiving messages (with session tracking)
tail -f logs/latest.log &
curl -X POST http://localhost:8000/api/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"message": {"text": "debug test"}}'

# 2. Look for processing start
grep "Processing text message.*debug test" logs/latest.log

# 3. Check LLM analysis stage
grep "STARTING LLM ANALYSIS.*debug test" logs/latest.log

# 4. Verify LLM service response
grep -A 5 -B 5 "debug test" logs/latest.log | grep -i "llm\|openrouter"

# 5. Check response generation
grep "Generated response" logs/latest.log | tail -1

# 6. Look for any errors in the flow
grep -i "error\|failed" logs/latest.log | tail -10

# 7. Session-based correlation (NEW)
# If debugging spans multiple sessions, check session-specific logs
CURRENT_SESSION=$(ls -t logs/*-*.log 2>/dev/null | head -1 | sed 's/.*-\(.*\)\.log/\1/')
if [ ! -z "$CURRENT_SESSION" ]; then
  echo "Checking session-specific log: $CURRENT_SESSION"
  grep "debug test" logs/*-${CURRENT_SESSION}.log
fi
```

### 2. Performance Issue Debugging

**Scenario:** Slow response times reported

```bash
# 1. Test current performance
time curl -X POST http://localhost:8000/api/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"message": {"text": "performance check"}}'

# 2. Check for bottlenecks in logs
grep "performance check" logs/latest.log | grep -i "time\|duration\|ms"

# 3. Analyze component timing
grep -i "cache.*hit\|cache.*miss" logs/latest.log | tail -10
grep -i "connection.*pool" logs/latest.log | tail -5
grep -i "worker.*pool\|queue" logs/latest.log | tail -5

# 4. Check for resource constraints
grep -i "memory\|cpu\|timeout" logs/latest.log | tail -10
```

### 3. MCP Integration Debugging

**Scenario:** Tool calls not working properly

```bash
# 1. Check MCP server connections
grep -i "mcp.*connect\|mcp.*server" logs/latest.log | tail -10

# 2. Test tool availability
curl -X GET http://localhost:8000/api/v1/tools

# 3. Check tool execution in logs
grep -i "tool.*call\|mcp.*tool" logs/latest.log | tail -10

# 4. Look for connection pool health
grep -i "connection.*pool.*health" logs/latest.log | tail -5

# 5. Check for circuit breaker activation
grep -i "circuit.*breaker\|circuit.*open" logs/latest.log
```

### 4. System Health Monitoring

**Regular Health Check Routine:**

```bash
#!/bin/bash
# health-check.sh - Autonomous system health monitoring

echo "=== System Health Check $(date) ==="

# 1. API endpoint health
curl -s http://localhost:8000/api/v1/health | jq .

# 2. Recent errors (last 100 lines)
echo "Recent Errors:"
tail -n 100 logs/latest.log | grep -i "\[ERROR\]" | tail -5

# 3. Recent warnings
echo "Recent Warnings:"
tail -n 100 logs/latest.log | grep -i "\[WARN\]" | tail -3

# 4. System performance indicators
echo "Performance Indicators:"
tail -n 100 logs/latest.log | grep -i "response.*time\|cache.*hit" | tail -3

# 5. Component status
echo "Component Status:"
tail -n 100 logs/latest.log | grep -i "orchestrator\|initialized\|operational" | tail -3

echo "=== Health Check Complete ==="
```

## E. Common Error Patterns and Solutions

### 1. Connection Timeouts

**Log Pattern:**
```
[ERROR] [MCPClient] Connection failed: timeout after 5000ms
[WARN] [ConnectionPool] Server connection lost: weather-server
```

**Debugging Steps:**
```bash
# Check connection pool status
grep -i "connection.*pool" logs/latest.log | tail -10

# Verify MCP server availability
grep -i "mcp.*health\|mcp.*ping" logs/latest.log | tail -5

# Check for circuit breaker activation
grep -i "circuit.*breaker" logs/latest.log | tail -5
```

### 2. Memory or Resource Issues

**Log Pattern:**
```
[WARN] [LRUCache] Cache eviction due to memory pressure
[ERROR] [WorkerPool] Worker allocation failed: resource limit
```

**Debugging Steps:**
```bash
# Check resource usage patterns
grep -i "memory\|cache.*evict\|worker.*limit" logs/latest.log | tail -10

# Analyze cache performance
grep -i "cache.*hit\|cache.*miss" logs/latest.log | tail -10
```

### 3. API Rate Limiting

**Log Pattern:**
```
[WARN] [OpenRouterService] Rate limit exceeded: 429 Too Many Requests
[ERROR] [LLMService] Request failed: rate limited
```

**Debugging Steps:**
```bash
# Check rate limiting patterns
grep -i "rate.*limit\|429\|too.*many" logs/latest.log

# Analyze request frequency
grep -i "openrouter\|llm.*request" logs/latest.log | tail -10
```

## F. Log Management and Maintenance

### Log File Maintenance

**Automatic Cleanup Script:**
```bash
#!/bin/bash
# cleanup-logs.sh - Remove logs older than 7 days

find logs/ -name "*.log" -type f -mtime +7 -delete
echo "Cleaned up logs older than 7 days"

# Keep only latest 50 log files
ls -t logs/*.log | tail -n +51 | xargs rm -f
echo "Kept only latest 50 log files"
```

### Log Analysis Tools

**Useful Commands:**
```bash
# Count errors by type
grep -i "\[ERROR\]" logs/latest.log | cut -d']' -f3 | sort | uniq -c

# Performance analysis
grep -i "processing.*ms" logs/latest.log | awk '{print $NF}' | sort -n

# Component activity analysis
grep -o "\[[A-Za-z]*\]" logs/latest.log | sort | uniq -c | sort -nr
```

This comprehensive logging and debugging guide enables autonomous troubleshooting and system monitoring, providing the observability needed for effective system maintenance and optimization.