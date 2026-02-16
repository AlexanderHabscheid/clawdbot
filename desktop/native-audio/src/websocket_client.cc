/**
 * WebSocket Client Implementation
 * 
 * Queue-based implementation that bridges to JavaScript WebSocket.
 * For production, can be upgraded to native libwebsockets.
 */

#include "websocket_client.h"
#include <cstring>

namespace centris {

WebSocketClient::WebSocketClient() = default;

WebSocketClient::~WebSocketClient() {
  Disconnect();
}

bool WebSocketClient::Initialize(const WSConfig& config) {
  config_ = config;
  state_.store(WSConnectionState::Disconnected);
  return true;
}

bool WebSocketClient::Connect() {
  if (state_.load() == WSConnectionState::Connected) {
    return true;
  }
  
  state_.store(WSConnectionState::Connecting);
  
  // In IPC bridge mode, the actual connection is handled by JavaScript
  // We just signal that we want to connect
  
  return true;
}

void WebSocketClient::Disconnect() {
  state_.store(WSConnectionState::Disconnected);
  
  // Clear any pending messages
  std::lock_guard<std::mutex> lock(queueMutex_);
  while (!outQueue_.empty()) {
    outQueue_.pop();
  }
}

bool WebSocketClient::SendText(const std::string& message) {
  // In IPC bridge mode, always queue messages for JavaScript to retrieve
  std::vector<uint8_t> data(message.begin(), message.end());
  QueueMessage(WSMessageType::Text, std::move(data));
  return true;
}

bool WebSocketClient::SendBinary(const std::vector<uint8_t>& data) {
  // In IPC bridge mode, always queue messages for JavaScript to retrieve
  QueueMessage(WSMessageType::Binary, data);
  return true;
}

bool WebSocketClient::SendBinaryWithSequence(uint32_t sequence, const std::vector<uint8_t>& data) {
  // In IPC bridge mode, JavaScript handles the actual Socket.IO connection.
  // Always queue audio chunks regardless of native WebSocket state since
  // JavaScript will retrieve them via GetQueuedMessages() and send via Socket.IO.
  // The connection state check is removed to fix dictation mode issue where
  // audio chunks were never being queued due to state being Disconnected.
  
  // Prepend sequence number (4 bytes, little-endian)
  std::vector<uint8_t> message(4 + data.size());
  message[0] = static_cast<uint8_t>(sequence & 0xFF);
  message[1] = static_cast<uint8_t>((sequence >> 8) & 0xFF);
  message[2] = static_cast<uint8_t>((sequence >> 16) & 0xFF);
  message[3] = static_cast<uint8_t>((sequence >> 24) & 0xFF);
  std::memcpy(message.data() + 4, data.data(), data.size());
  
  QueueMessage(WSMessageType::Binary, std::move(message));
  return true;
}

std::vector<WSOutMessage> WebSocketClient::GetQueuedMessages() {
  std::lock_guard<std::mutex> lock(queueMutex_);
  
  std::vector<WSOutMessage> messages;
  while (!outQueue_.empty()) {
    messages.push_back(std::move(outQueue_.front()));
    outQueue_.pop();
  }
  
  return messages;
}

void WebSocketClient::OnMessageReceived(const std::string& message) {
  if (messageCb_) {
    messageCb_(message);
  }
}

void WebSocketClient::OnBinaryReceived(const std::vector<uint8_t>& data) {
  if (binaryCb_) {
    binaryCb_(data);
  }
}

void WebSocketClient::OnConnected() {
  state_.store(WSConnectionState::Connected);
  if (connectedCb_) {
    connectedCb_();
  }
}

void WebSocketClient::OnDisconnected() {
  state_.store(WSConnectionState::Disconnected);
  if (disconnectedCb_) {
    disconnectedCb_();
  }
}

void WebSocketClient::OnError(const std::string& error) {
  state_.store(WSConnectionState::Error);
  if (errorCb_) {
    errorCb_(error);
  }
}

void WebSocketClient::QueueMessage(WSMessageType type, std::vector<uint8_t> data) {
  std::lock_guard<std::mutex> lock(queueMutex_);
  outQueue_.push(WSOutMessage{type, std::move(data)});
}

} // namespace centris
