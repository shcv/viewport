package viewer

import (
	"encoding/binary"
	"errors"
	"fmt"

	"github.com/fxamacker/cbor/v2"
)

// Wire format constants.
const (
	HeaderSize      = 8
	Magic           = 0x5650 // ASCII 'VP'
	ProtocolVersion = 1
)

// Errors returned by wire format functions.
var (
	ErrBufferTooShort = errors.New("buffer too short for frame header")
	ErrBadMagic       = errors.New("invalid magic bytes in frame header")
	ErrPayloadTooShort = errors.New("buffer too short for complete frame")
)

// EncodeHeader writes an 8-byte frame header for the given message type
// and payload length.
//
// Wire layout:
//
//	[0:2]  magic   (big-endian uint16, 0x5650)
//	[2]    version (uint8, 1)
//	[3]    type    (uint8, MessageType)
//	[4:8]  length  (little-endian uint32, payload bytes)
func EncodeHeader(msgType MessageType, payloadLength uint32) []byte {
	buf := make([]byte, HeaderSize)
	// Magic bytes in big-endian
	binary.BigEndian.PutUint16(buf[0:2], Magic)
	// Version
	buf[2] = ProtocolVersion
	// Message type
	buf[3] = byte(msgType)
	// Payload length in little-endian
	binary.LittleEndian.PutUint32(buf[4:8], payloadLength)
	return buf
}

// DecodeHeader parses an 8-byte frame header from data.
// Returns an error if the buffer is too short or the magic bytes don't match.
func DecodeHeader(data []byte) (*FrameHeader, error) {
	if len(data) < HeaderSize {
		return nil, ErrBufferTooShort
	}

	magic := binary.BigEndian.Uint16(data[0:2])
	if magic != Magic {
		return nil, ErrBadMagic
	}

	return &FrameHeader{
		Magic:   magic,
		Version: data[2],
		Type:    MessageType(data[3]),
		Length:  binary.LittleEndian.Uint32(data[4:8]),
	}, nil
}

// EncodeFrame encodes a protocol message into a complete frame
// (header + CBOR payload).
func EncodeFrame(msg *ProtocolMessage) ([]byte, error) {
	payload, err := encodeCBORPayload(msg)
	if err != nil {
		return nil, fmt.Errorf("cbor encode: %w", err)
	}

	header := EncodeHeader(msg.Type, uint32(len(payload)))
	frame := make([]byte, HeaderSize+len(payload))
	copy(frame[0:HeaderSize], header)
	copy(frame[HeaderSize:], payload)
	return frame, nil
}

// DecodeFrame splits a complete frame into header and decoded message.
// The data must contain at least header + payload bytes.
func DecodeFrame(data []byte) (*FrameHeader, []byte, error) {
	header, err := DecodeHeader(data)
	if err != nil {
		return nil, nil, err
	}

	totalSize := HeaderSize + int(header.Length)
	if len(data) < totalSize {
		return nil, nil, ErrPayloadTooShort
	}

	payload := data[HeaderSize:totalSize]
	return header, payload, nil
}

// DecodeCBORPayload decodes CBOR bytes into a generic map.
func DecodeCBORPayload(payload []byte) (map[string]interface{}, error) {
	var result map[string]interface{}
	if err := cbor.Unmarshal(payload, &result); err != nil {
		return nil, fmt.Errorf("cbor unmarshal: %w", err)
	}
	return result, nil
}

// encodeCBORPayload encodes a protocol message to CBOR bytes.
func encodeCBORPayload(msg *ProtocolMessage) ([]byte, error) {
	// Build a generic map for CBOR encoding
	m := make(map[string]interface{})
	m["type"] = uint8(msg.Type)

	switch msg.Type {
	case MsgDefine:
		if msg.Slot != nil {
			m["slot"] = *msg.Slot
		}
		if msg.SlotValue != nil {
			m["value"] = msg.SlotValue
		}
	case MsgTree:
		if msg.Root != nil {
			m["root"] = encodeVNode(msg.Root)
		}
	case MsgPatch:
		m["ops"] = msg.Ops
	case MsgData:
		if msg.Schema != nil {
			m["schema"] = *msg.Schema
		}
		m["row"] = msg.Row
	case MsgInput:
		if msg.Event != nil {
			m["event"] = msg.Event
		}
	case MsgEnv:
		if msg.Env != nil {
			m["env"] = msg.Env
		}
	case MsgSchema:
		if msg.Slot != nil {
			m["slot"] = *msg.Slot
		}
		m["columns"] = msg.Columns
	}

	return cbor.Marshal(m)
}

// encodeVNode converts a VNode to a map suitable for CBOR encoding.
func encodeVNode(v *VNode) map[string]interface{} {
	m := map[string]interface{}{
		"id":   v.ID,
		"type": string(v.Type),
	}
	m["props"] = v.Props
	if len(v.Children) > 0 {
		children := make([]interface{}, len(v.Children))
		for i, c := range v.Children {
			children[i] = encodeVNode(c)
		}
		m["children"] = children
	}
	if v.TextAlt != nil {
		m["textAlt"] = *v.TextAlt
	}
	return m
}

// ── FrameReader: streaming frame parser ──────────────────────────────

// Frame holds a decoded frame header and its raw payload bytes.
type Frame struct {
	Header  *FrameHeader
	Payload []byte
}

// FrameReader is a streaming parser that buffers incoming bytes and
// extracts complete frames. It handles partial reads.
type FrameReader struct {
	buffer []byte
}

// NewFrameReader creates a new streaming frame reader.
func NewFrameReader() *FrameReader {
	return &FrameReader{
		buffer: make([]byte, 0, 4096),
	}
}

// Feed appends data to the internal buffer and returns any complete
// frames that can be extracted. Remaining partial data stays buffered.
func (fr *FrameReader) Feed(data []byte) ([]Frame, error) {
	fr.buffer = append(fr.buffer, data...)

	var frames []Frame

	for len(fr.buffer) >= HeaderSize {
		header, err := DecodeHeader(fr.buffer)
		if err != nil {
			if errors.Is(err, ErrBadMagic) {
				// Bad magic: skip one byte and try again (recovery)
				fr.buffer = fr.buffer[1:]
				continue
			}
			return frames, err
		}

		totalSize := HeaderSize + int(header.Length)
		if len(fr.buffer) < totalSize {
			break // need more data
		}

		payload := make([]byte, header.Length)
		copy(payload, fr.buffer[HeaderSize:totalSize])
		frames = append(frames, Frame{Header: header, Payload: payload})
		fr.buffer = fr.buffer[totalSize:]
	}

	return frames, nil
}

// PendingBytes returns the number of bytes buffered but not yet
// forming a complete frame.
func (fr *FrameReader) PendingBytes() int {
	return len(fr.buffer)
}
