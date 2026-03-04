{
  description = "CLI Pomodoro Timer";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
  };

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      packages.${system}.default = pkgs.buildPnpmPackage {
        pname = "pomodoro-cli";
        version = "1.0.0";

        src = pkgs.lib.cleanSource ./.;

        # 最初は fakeHash
        pnpmDepsHash = pkgs.lib.fakeHash;

        nodejs = pkgs.nodejs_20;

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

      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.nodejs_20
          pkgs.pnpm
        ];
      };
    };
}
