const DEFAULT_ICE_SERVERS = [
  {
    urls: "stun:stun.l.google.com:19302"
  }
];

export function createMultiplayerPeer(options) {
  const peerConnection = new RTCPeerConnection({
    iceServers: DEFAULT_ICE_SERVERS
  });
  let dataChannel = null;
  let closed = false;

  peerConnection.addEventListener("icecandidate", (event) => {
    if (!event.candidate) {
      return;
    }

    options.onSignal?.({
      candidate: event.candidate.toJSON()
    });
  });

  peerConnection.addEventListener("connectionstatechange", () => {
    options.onConnectionStateChange?.(peerConnection.connectionState);
  });

  peerConnection.addEventListener("iceconnectionstatechange", () => {
    options.onIceConnectionStateChange?.(peerConnection.iceConnectionState);
  });

  peerConnection.addEventListener("datachannel", (event) => {
    attachDataChannel(event.channel);
  });

  if (options.isHost) {
    attachDataChannel(
      peerConnection.createDataChannel("swarmbattle", {
        ordered: true
      })
    );
  }

  return {
    async startAsHost() {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      options.onSignal?.({
        description: toDescriptionPayload(peerConnection.localDescription)
      });
    },
    async applySignal(payload) {
      if (payload.description) {
        const description = new RTCSessionDescription(payload.description);
        await peerConnection.setRemoteDescription(description);

        if (description.type === "offer") {
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          options.onSignal?.({
            description: toDescriptionPayload(peerConnection.localDescription)
          });
        }
      }

      if (payload.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    },
    send(message) {
      if (!dataChannel || dataChannel.readyState !== "open") {
        throw new Error("WebRTC data channel is not open.");
      }

      dataChannel.send(JSON.stringify(message));
    },
    close() {
      if (closed) {
        return;
      }

      closed = true;
      dataChannel?.close();
      peerConnection.close();
    }
  };

  function attachDataChannel(channel) {
    dataChannel = channel;

    channel.addEventListener("open", () => {
      options.onChannelStateChange?.(channel.readyState);
      options.onOpen?.();
      channel.send(JSON.stringify({
        type: "hello",
        role: options.isHost ? "host" : "guest"
      }));
    });

    channel.addEventListener("close", () => {
      options.onChannelStateChange?.(channel.readyState);
      options.onClose?.();
    });

    channel.addEventListener("error", () => {
      options.onError?.("WebRTC data channel error.");
    });

    channel.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        options.onMessage?.(payload);
      } catch (error) {
        options.onError?.("Invalid WebRTC data channel message.");
      }
    });

    options.onChannelStateChange?.(channel.readyState);
  }
}

function toDescriptionPayload(description) {
  if (!description) {
    return null;
  }

  return {
    type: description.type,
    sdp: description.sdp
  };
}
