package main

import (
	"encoding/json"
	"fmt"
	"os"

	epsfc "github.com/xkiian/ticketmaster-epsfc"
)

func main() {
	solver, err := epsfc.NewPowSolver(nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "epsfc: init error: %v\n", err)
		os.Exit(1)
	}

	cookie, err := solver.GetCookie()
	if err != nil {
		fmt.Fprintf(os.Stderr, "epsfc: solve error: %v\n", err)
		os.Exit(1)
	}

	out, _ := json.Marshal(map[string]string{"cookie": cookie})
	fmt.Println(string(out))
}
