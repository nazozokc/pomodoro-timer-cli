{
  description = "CLI Pomodoro Timer";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
  };

  outputs =
    { self, nixpkgs }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
    in
    {
      packages.x86_64-linux.default = pkgs.stdenv.mkDerivation {
        pname = "pomodoro-cli";
        version = "1.0.0";
        src = self;
        buildInputs = [
          pkgs.nodejs_20
          pkgs.pnpm
        ];
        buildPhase = ''
          pnpm install --frozen-lockfile --ignore-scripts
        '';
        installPhase = ''
          mkdir -p $out/bin
          cp src/index.js $out/bin/pomodoro
          chmod +x $out/bin/pomodoro
        '';
        postFixup = ''
          substituteInPlace $out/bin/pomodoro \
            --replace '#!/usr/bin/env node' '#!${pkgs.nodejs_20}/bin/node'
        '';
      };

      devShells.x86_64-linux.default = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs_20
          pkgs.pnpm
        ];
      };
    };
}
