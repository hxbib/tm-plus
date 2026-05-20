package ticketmaster_epsfc

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
)

func SolvePow(challenge string, difficulty int) int64 {

	zeroBits := difficulty * 4
	numWorkers := runtime.NumCPU()
	found := int64(-1)

	var wg sync.WaitGroup
	wg.Add(numWorkers)

	challengeBytes := []byte(challenge)

	for worker := 0; worker < numWorkers; worker++ {
		go func(startNonce int64) {
			defer wg.Done()

			nonce := startNonce
			buf := make([]byte, len(challengeBytes)+20)
			copy(buf, challengeBytes)

			for {
				if atomic.LoadInt64(&found) != -1 {
					return
				}

				nonceStr := formatInt64(nonce)
				copy(buf[len(challengeBytes):], nonceStr)
				inputLen := len(challengeBytes) + len(nonceStr)

				hash := sha256.Sum256(buf[:inputLen])

				if hasLeadingZeroBits(hash[:], zeroBits) {
					atomic.CompareAndSwapInt64(&found, -1, nonce)
					return
				}

				nonce += int64(numWorkers)
			}
		}(int64(worker))
	}

	wg.Wait()
	return atomic.LoadInt64(&found)
}

func formatInt64(n int64) []byte {
	if n == 0 {
		return []byte{'0'}
	}

	buf := make([]byte, 20)
	i := len(buf)

	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}

	return buf[i:]
}

func hasLeadingZeroBits(hash []byte, bits int) bool {
	fullBytes := bits / 8
	remainingBits := bits % 8

	for i := 0; i < fullBytes; i++ {
		if hash[i] != 0 {
			return false
		}
	}

	if remainingBits > 0 {
		mask := byte(0xFF << (8 - remainingBits))
		if hash[fullBytes]&mask != 0 {
			return false
		}
	}

	return true
}

func SolvePowSingleThreaded(challenge string, difficulty int) int64 {
	prefix := strings.Repeat("0", difficulty)
	nonce := int64(0)

	for {
		input := fmt.Sprintf("%s%d", challenge, nonce)

		hash := sha256.Sum256([]byte(input))
		hashHex := hex.EncodeToString(hash[:])

		if strings.HasPrefix(hashHex, prefix) {
			return nonce
		}

		nonce++
	}
}
