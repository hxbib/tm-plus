package ticketmaster_epsfc

import (
	"encoding/json"
	"io"
	"strings"

	http "github.com/bogdanfinn/fhttp"
	tlsclient "github.com/bogdanfinn/tls-client"
	"github.com/bogdanfinn/tls-client/profiles"
)

type PowSolver struct {
	client tlsclient.HttpClient
}

type PowChallenge struct {
	Challenge  string `json:"challenge"`
	Difficulty int    `json:"difficulty"`
	Signature  string `json:"signature"`
	Nonce      int64  `json:"nonce"`
}

func NewPowSolver(client tlsclient.HttpClient) (*PowSolver, error) {
	if client == nil {
		jar := tlsclient.NewCookieJar()
		options := []tlsclient.HttpClientOption{
			tlsclient.WithTimeoutSeconds(30),
			tlsclient.WithClientProfile(profiles.Chrome_133),
			tlsclient.WithCookieJar(jar),
		}
		var err error
		client, err = tlsclient.NewHttpClient(tlsclient.NewNoopLogger(), options...)
		if err != nil {
			return nil, err
		}
		client.SetFollowRedirect(true)
	}

	return &PowSolver{client: client}, nil
}

func (p *PowSolver) GetCookie() (string, error) {
	challenge, err := p.GetChallenge()
	if err != nil {
		return "", err
	}

	return p.VerifyChallenge(challenge)
}

func (p *PowSolver) GetChallenge() (*PowChallenge, error) {
	req, err := http.NewRequest(http.MethodGet, "https://www.ticketmaster.com/epsf/pow/request", nil)
	if err != nil {
		return nil, err
	}

	req.Header = http.Header{
		"sec-ch-ua-platform": {"\"Windows\""},
		"user-agent":         {"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"},
		"sec-ch-ua":          {"\"Chromium\";v=\"142\", \"Brave\";v=\"142\", \"Not_A Brand\";v=\"99\""},
		"sec-ch-ua-mobile":   {"?0"},
		"accept":             {"*/*"},
		"sec-gpc":            {"1"},
		"accept-language":    {"en-US,en;q=0.9"},
		"sec-fetch-site":     {"same-origin"},
		"sec-fetch-mode":     {"cors"},
		"sec-fetch-dest":     {"empty"},
		"referer":            {"https://www.ticketmaster.com/"},
		"accept-encoding":    {"gzip, deflate, br, zstd"},
		"priority":           {"u=1, i"},
		http.HeaderOrderKey:  {"sec-ch-ua-platform", "user-agent", "sec-ch-ua", "sec-ch-ua-mobile", "accept", "sec-gpc", "accept-language", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "referer", "accept-encoding", "cookie", "priority"},
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}

	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var challenge PowChallenge
	err = json.Unmarshal(body, &challenge)
	if err != nil {
		return nil, err
	}

	return &challenge, nil
}

func (p *PowSolver) VerifyChallenge(challenge *PowChallenge) (string, error) {

	challenge.Nonce = SolvePow(challenge.Challenge, challenge.Difficulty)

	body, err := json.Marshal(challenge)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, "https://www.ticketmaster.com/epsf/pow/validate", strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}

	req.Header = http.Header{
		"sec-ch-ua-platform": {"\"Windows\""},
		"user-agent":         {"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"},
		"sec-ch-ua":          {"\"Chromium\";v=\"142\", \"Brave\";v=\"142\", \"Not_A Brand\";v=\"99\""},
		"content-type":       {"application/json"},
		"sec-ch-ua-mobile":   {"?0"},
		"accept":             {"*/*"},
		"sec-gpc":            {"1"},
		"accept-language":    {"en-US,en;q=0.9"},
		"origin":             {"https://www.ticketmaster.com"},
		"sec-fetch-site":     {"same-origin"},
		"sec-fetch-mode":     {"cors"},
		"sec-fetch-dest":     {"empty"},
		"referer":            {"https://www.ticketmaster.com/"},
		"accept-encoding":    {"gzip, deflate, br, zstd"},
		"priority":           {"u=1, i"},
		http.HeaderOrderKey:  {"content-length", "sec-ch-ua-platform", "user-agent", "sec-ch-ua", "content-type", "sec-ch-ua-mobile", "accept", "sec-gpc", "accept-language", "origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "referer", "accept-encoding", "cookie", "priority"},
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return "", err
	}

	defer resp.Body.Close()

	return resp.Header.Get("set-cookie"), nil
}
