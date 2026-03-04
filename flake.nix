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
      lib = pkgs.lib;
    in
    {
      packages.${system}.default = pkgs.buildNpmPackage {
        pname = "pomodoro-cli";
        version = "1.2.0";

        src = pkgs.lib.cleanSource ./.;

        npmDepsHash = "sha256-Q38fJLAU7rYrA1EKSAx0L631rxx1Hnp4yPyAMLe2isQ=";
        nodejs = pkgs.nodejs_20;

        dontNpmBuild = true;

      };

      apps.${system}.default = {
        type = "app";
        program = "${self.packages.${system}.default}/bin/pomodoro";
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.nodejs_20
          pkgs.npm
        ];
      };
    };
}
