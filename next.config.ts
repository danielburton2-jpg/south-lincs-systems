const nextConfig = {

  typescript: {

    /* allow builds even with TS errors */

    ignoreBuildErrors: true,

  },

  eslint: {

    /* prevent eslint from stopping builds */

    ignoreDuringBuilds: true,

  }

}

export default nextConfig