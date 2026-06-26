export function createSignalingClient(url, handlers) {
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    handlers.onOpen?.();
  });

  socket.addEventListener("close", () => {
    handlers.onClose?.();
  });

  socket.addEventListener("error", () => {
    handlers.onError?.("Failed to reach signaling server.");
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data));
      handlers.onMessage?.(message);
    } catch (error) {
      handlers.onError?.("Invalid signaling message from server.");
    }
  });

  return {
    send(message) {
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error("Signaling socket is not open.");
      }

      socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    }
  };
}
