/**
 * Native WebSocket Client
 * 
 * Provides direct WebSocket connection to Centris backend for streaming audio.
 * Uses a simple implementation that can be upgraded to libwebsockets for production.
 * 
 * For now, this is a placeholder that communicates via IPC to let Node.js handle
 * the actual WebSocket connection. This can be upgraded to native libwebsockets
 * for even lower latency.
 */

#ifndef CENTRIS_WEBSOCKET_CLIENT_H
#define CENTRIS_WEBSOCKET_CLIENT_H

#include <string>
#include <vector>
#include <functional>
#include <atomic>
#include <mutex>
#include <queue>
#include <thread>
#include <condition_variable>

namespace centris {

/**
 * WebSocket connection state
 */
enum class WSConnectionState {
  Disconnected,
  Connecting,
  Connected,
  Reconnecting,
  Error
};

/**
 * WebSocket message types
 */
enum class WSMessageType {
  Text,
  Binary
};

/**
 * WebSocket configuration
 */
struct WSConfig {
  std::string url;
  std::string authToken;
  int reconnectDelayMs = 1000;
  int maxReconnectAttempts = 5;
  int pingIntervalMs = 30000;
  int connectionTimeoutMs = 10000;
};

/**
 * Message to send
 */
struct WSOutMessage {
  WSMessageType type;
  std::vector<uint8_t> data;
};

/**
 * WebSocket Client
 * 
 * Note: This implementation uses a queue-based approach where messages are
 * queued and consumed by the JavaScript layer via IPC. For production,
 * consider using libwebsockets for direct native WebSocket communication.
 */
class WebSocketClient {
public:
  WebSocketClient();
  ~WebSocketClient();

  /**
   * Initialize with configuration
   */
  bool Initialize(const WSConfig& config);

  /**
   * Connect to server
   */
  bool Connect();

  /**
   * Disconnect from server
   */
  void Disconnect();

  /**
   * Send text message
   */
  bool SendText(const std::string& message);

  /**
   * Send binary data
   */
  bool SendBinary(const std::vector<uint8_t>& data);

  /**
   * Send binary data with sequence number prefix
   */
  bool SendBinaryWithSequence(uint32_t sequence, const std::vector<uint8_t>& data);

  /**
   * Get connection state
   */
  WSConnectionState GetState() const { return state_.load(); }

  /**
   * Check if connected
   */
  bool IsConnected() const { return state_.load() == WSConnectionState::Connected; }

  /**
   * Get queued messages (for IPC bridge)
   * Returns messages and clears the queue
   */
  std::vector<WSOutMessage> GetQueuedMessages();

  /**
   * Handle incoming message from IPC bridge
   */
  void OnMessageReceived(const std::string& message);
  void OnBinaryReceived(const std::vector<uint8_t>& data);

  /**
   * Handle connection events from IPC bridge
   */
  void OnConnected();
  void OnDisconnected();
  void OnError(const std::string& error);

  // Callbacks
  using MessageCallback = std::function<void(const std::string& message)>;
  using BinaryCallback = std::function<void(const std::vector<uint8_t>& data)>;
  using ConnectedCallback = std::function<void()>;
  using DisconnectedCallback = std::function<void()>;
  using ErrorCallback = std::function<void(const std::string& error)>;

  void SetMessageCallback(MessageCallback cb) { messageCb_ = cb; }
  void SetBinaryCallback(BinaryCallback cb) { binaryCb_ = cb; }
  void SetConnectedCallback(ConnectedCallback cb) { connectedCb_ = cb; }
  void SetDisconnectedCallback(DisconnectedCallback cb) { disconnectedCb_ = cb; }
  void SetErrorCallback(ErrorCallback cb) { errorCb_ = cb; }

  // Configuration access
  const WSConfig& GetConfig() const { return config_; }

private:
  void QueueMessage(WSMessageType type, std::vector<uint8_t> data);

  WSConfig config_;
  std::atomic<WSConnectionState> state_{WSConnectionState::Disconnected};
  
  // Message queue (for IPC bridge mode)
  std::mutex queueMutex_;
  std::queue<WSOutMessage> outQueue_;
  
  // Callbacks
  MessageCallback messageCb_;
  BinaryCallback binaryCb_;
  ConnectedCallback connectedCb_;
  DisconnectedCallback disconnectedCb_;
  ErrorCallback errorCb_;
};

} // namespace centris

#endif // CENTRIS_WEBSOCKET_CLIENT_H
