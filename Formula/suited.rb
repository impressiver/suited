class Suited < Formula
  desc "Generate tailored, factually-accurate PDF resumes from LinkedIn data"
  homepage "https://github.com/impressiver/suited"
  version "1.0.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/impressiver/suited/releases/download/v#{version}/suited-macos-arm64"
      sha256 "REPLACE_MACOS_ARM64_SHA256"

      def install
        bin.install "suited-macos-arm64" => "suited"
      end
    end
  end

  on_linux do
    if Hardware::CPU.intel?
      url "https://github.com/impressiver/suited/releases/download/v#{version}/suited-linux-x64"
      sha256 "REPLACE_LINUX_X64_SHA256"

      def install
        bin.install "suited-linux-x64" => "suited"
      end
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/suited --version")
  end
end
