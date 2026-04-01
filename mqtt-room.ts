import { MqttClient } from "mqtt";

function convertUint8Array(data: Uint8Array<ArrayBuffer>): ArrayBuffer {
	return data.buffer.slice(
		data.byteOffset,
		data.byteLength + data.byteOffset
	);
}

function bigintToBytes(number: bigint) {
	const buffer = new ArrayBuffer(8);
	const view = new DataView(buffer);
	view.setBigUint64(0, number, false);
	return buffer;
}

function bytesToBigint(bytes: ArrayBuffer): bigint {
	const view = new DataView(bytes);
	return view.getBigUint64(0, false);
}

export async function generateKey() {
	return await crypto.subtle.generateKey(
		{
			name: "AES-GCM",
			length: 256,
		},
		true,
		["encrypt", "decrypt"]
	);
}

export async function deriveKey(password: string, salt: string) {
	const initialKey = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password) as Uint8Array<ArrayBuffer>,
		{ name: "PBKDF2" },
		false,
		["deriveKey"]
	);
	return await crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: new TextEncoder().encode(salt) as Uint8Array<ArrayBuffer>,
			iterations: 100000,
			hash: "SHA-256",
		},
		initialKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

export async function exportKey(key: CryptoKey) {
	return await crypto.subtle.exportKey("raw", key).then((buffer) =>
		new Uint8Array(buffer).toBase64({
			alphabet: "base64url",
			omitPadding: false,
		})
	);
}

export async function importKey(encoded: string) {
	let data = Uint8Array.fromBase64(encoded, {
		alphabet: "base64url",
		lastChunkHandling: "strict",
	});

	return await crypto.subtle.importKey(
		"raw",
		convertUint8Array(data),
		{ name: "AES-GCM" },
		true,
		["encrypt", "decrypt"]
	);
}

async function encrypt(key: CryptoKey, data: ArrayBuffer) {
	const iv = generateRandom(12);
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		data
	);

	const buffer = new Uint8Array(12 + encrypted.byteLength);
	buffer.set(iv, 0);
	buffer.set(new Uint8Array(encrypted), 12);
	return convertUint8Array(buffer);
}

async function decrypt(key: CryptoKey, data: ArrayBuffer) {
	return await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: data.slice(0, 12) },
		key,
		data.slice(12)
	);
}

function generateRandom(length: number) {
	const data = new Uint8Array(length);
	crypto.getRandomValues(data);
	return data;
}

async function compress(bytes: ArrayBuffer): Promise<ArrayBuffer> {
	const compressedStream = (
		new Response(bytes).body as ReadableStream<Uint8Array<ArrayBuffer>>
	).pipeThrough(new CompressionStream("deflate-raw"));
	return await new Response(compressedStream).arrayBuffer();
}

async function decompress(bytes: ArrayBuffer): Promise<ArrayBuffer> {
	const decompressedStream = (
		new Response(bytes).body as ReadableStream<Uint8Array<ArrayBuffer>>
	).pipeThrough(new DecompressionStream("deflate-raw"));
	return await new Response(decompressedStream).arrayBuffer();
}

export type Identifier = bigint;

export interface Message {
	from: bigint;
	to?: bigint;
	payload?: Uint8Array<ArrayBuffer>;
}

async function decodeMessage(data: Uint8Array<ArrayBuffer>): Promise<Message> {
	if (data.length > 16) {
		return {
			from: bytesToBigint(convertUint8Array(data.slice(0, 8))),
			to: bytesToBigint(convertUint8Array(data.slice(8, 16))),
			payload: new Uint8Array(
				await decompress(convertUint8Array(data.slice(16)))
			),
		};
	} else if (data.length == 16) {
		return {
			from: bytesToBigint(convertUint8Array(data.slice(0, 8))),
			to: bytesToBigint(convertUint8Array(data.slice(8, 16))),
		};
	} else if (data.length == 8) {
		return {
			from: bytesToBigint(convertUint8Array(data)),
		};
	}

	throw "Malformed input length";
}

async function encodeMessage(
	message: Message
): Promise<Uint8Array<ArrayBuffer>> {
	if (message.from != selfId) {
		throw "Invalid message ID";
	}

	if (message.to) {
		if (message.payload) {
			const compressed = new Uint8Array(
				await compress(convertUint8Array(message.payload))
			);

			const buffer = new Uint8Array(16 + compressed.length);
			buffer.set(new Uint8Array(bigintToBytes(message.from)), 0);
			buffer.set(new Uint8Array(bigintToBytes(message.to)), 8);
			buffer.set(compressed, 16);
			return buffer;
		} else {
			const buffer = new Uint8Array(16);
			buffer.set(new Uint8Array(bigintToBytes(message.from)), 0);
			buffer.set(new Uint8Array(bigintToBytes(message.to)), 8);
			return buffer;
		}
	} else if (!message.payload) {
		return new Uint8Array(bigintToBytes(message.from));
	}

	throw "Invalid message";
}

export const selfId: bigint = bytesToBigint(
	convertUint8Array(generateRandom(8))
);

export class MqttRoom {
	topic: string;
	key: CryptoKey;
	client: MqttClient;
	public constructor(
		client: MqttClient,
		topic: string,
		key: CryptoKey,
		onMessage: (message: Message) => void
	) {
		this.topic = topic;
		this.key = key;
		this.client = client;

		this.client.on("error", console.error);
		this.client.on("message", async (topic, buffer) => {
			if (topic == this.topic) {
				let message;

				try {
					message = await decodeMessage(
						new Uint8Array(
							await decrypt(
								this.key,
								convertUint8Array(
									buffer as Uint8Array<ArrayBuffer>
								)
							)
						)
					);
				} catch (error) {
					console.error(error);
				}

				if (message && message.from != selfId) {
					onMessage(message);
				}
			}
		});
		this.client.on("connect", () => {
			this.client.subscribe(this.topic, { qos: 1 });
		});
		if (client.connected) {
			this.client.subscribe(this.topic, { qos: 1 });
		}
	}
	public async send(message: Message) {
		this.client.publish(
			this.topic,
			new Uint8Array(
				await encrypt(
					this.key,
					convertUint8Array(await encodeMessage(message))
				)
			) as Buffer
		);
	}
}
