
## 📚 API Reference

### Core Methods

#### `app.ai.request(options, reply)`
Main method for making AI requests with automatic fallback and session management.

**Options:**
- `prompt` (string): The user's input prompt
- `context` (string, optional): System context/instructions
- `sessionId` (string, optional): Session identifier for conversation history
- `temperature` (number, optional): Model temperature (0-1)
- `maxTokens` (number, optional): Maximum tokens to generate
- `models` (array, optional): Specific models to use for this request
- `stream` (boolean, optional): Enable streaming responses
- `history` (array, optional): Previous conversation history

#### `app.ai.retrieveHistory(sessionId)`
Retrieve conversation history for a specific session.
