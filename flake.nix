{
  description = "CLI Pomodoro Timer";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
  };
  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.buildNpmPackage {
            pname = "pomodoro-cli";
            version = "1.2.0";
            src = self;
            npmDepsHash = "sha256-HVO7rYqXVvh4KVVBPQvK8ekhmwTrkSqRoul7iWj9Kyo=";
            nodejs = pkgs.nodejs_20;
            dontNpmBuild = true;
          };
        }
      );
      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/pomodoro";
        };
      });
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            buildInputs = [
              pkgs.nodejs_20 # >=20.17.0 required by mute-stream
              pkgs.nodejs_20.pkgs.npm # npm を明示
              pkgs.claude-code
              pkgs.neovim
            ];
            shellHook = ''
              echo "🍅 pomodoro dev shell (node $(node --version))"
            '';
          };
        }
      );
    };
}
