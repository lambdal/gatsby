const _ = require(`lodash`)
const path = require(`path`)
const { slash } = require(`gatsby-core-utils`)
const slugify = require(`slugify`)
const url = require(`url`)
const moment = require(`moment`)
const { langCodes } = require(`../i18n`)
const { getPrevAndNext } = require(`../get-prev-and-next.js`)

// convert a string like `/some/long/path/name-of-docs/` to `name-of-docs`
const slugToAnchor = slug =>
  slug
    .split(`/`) // split on dir separators
    .filter(item => item !== ``) // remove empty values
    .pop() // take last item

const docSlugFromPath = parsedFilePath => {
  if (parsedFilePath.name !== `index` && parsedFilePath.dir !== ``) {
    return `/${parsedFilePath.dir}/${parsedFilePath.name}/`
  } else if (parsedFilePath.dir === ``) {
    return `/${parsedFilePath.name}/`
  } else {
    return `/${parsedFilePath.dir}/`
  }
}

exports.createPages = async ({ graphql, actions }) => {
  const { createPage } = actions

  const docsTemplate = path.resolve(`src/templates/template-docs-markdown.js`)
  // const apiTemplate = path.resolve(`src/templates/template-api-markdown.js`)
  // const blogPostTemplate = path.resolve(`src/templates/template-blog-post.js`)
  // const blogListTemplate = path.resolve(`src/templates/template-blog-list.js`)
  // const tagTemplate = path.resolve(`src/templates/tags.js`)
  // const contributorPageTemplate = path.resolve(
  //   `src/templates/template-contributor-page.js`
  // )
  // const localPackageTemplate = path.resolve(
  //   `src/templates/template-docs-local-packages.js`
  // )

  const { data, errors } = await graphql(`
    query {
      allMdx(
        sort: { order: DESC, fields: [frontmatter___date, fields___slug] }
        limit: 10000
        filter: {
          fileAbsolutePath: { ne: null }
          fields: { locale: { eq: "en" } }
        }
      ) {
        nodes {
          fields {
            slug
            locale
            package
            released
          }
          frontmatter {
            title
            draft
            canonicalLink
            publishedAt
            tags
            jsdoc
            apiCalls
          }
        }
      }
      allAuthorYaml {
        nodes {
          fields {
            slug
          }
        }
      }
    }
  `)
  if (errors) throw errors

  const blogPosts = _.filter(data.allMdx.nodes, node => {
    const slug = _.get(node, `fields.slug`)
    const draft = _.get(node, `frontmatter.draft`)
    if (!slug) return undefined

    if (_.includes(slug, `/blog/`) && !draft) {
      return node
    }

    return undefined
  })

  const releasedBlogPosts = blogPosts.filter(post =>
    _.get(post, `fields.released`)
  )

  // Create docs pages.
  const docPages = data.allMdx.nodes
  docPages.forEach(node => {
    const slug = _.get(node, `fields.slug`)
    const locale = _.get(node, `fields.locale`)
    if (!slug) return

    if (!_.includes(slug, `/blog/`)) {
      const prevAndNext = getPrevAndNext(node.fields.slug)
      if (node.frontmatter.jsdoc) {
        // API template
        // createPage({
        //   path: `${node.fields.slug}`,
        //   component: slash(apiTemplate),
        //   context: {
        //     slug: node.fields.slug,
        //     jsdoc: node.frontmatter.jsdoc,
        //     apiCalls: node.frontmatter.apiCalls,
        //     ...prevAndNext,
        //   },
        // })
      } else if (node.fields.package) {
        // Local package template
        // createPage({
        //   path: `${node.fields.slug}`,
        //   component: slash(localPackageTemplate),
        //   context: {
        //     slug: node.fields.slug,
        //   },
        // })
      } else {
        // Docs template
        createPage({
          path: `${node.fields.slug}`,
          component: slash(docsTemplate),
          context: {
            slug: node.fields.slug,
            locale,
            ...prevAndNext,
          },
        })
      }
    }
  })
}

exports.onCreateNode = ({ node, actions, getNode }) => {
  const { createNodeField } = actions
  let slug
  let locale
  if (node.internal.type === `File`) {
    const parsedFilePath = path.parse(node.relativePath)
    // TODO add locale data for non-MDX files
    if (node.sourceInstanceName === `docs`) {
      slug = docSlugFromPath(parsedFilePath)
    }
    if (slug) {
      createNodeField({ node, name: `slug`, value: slug })
    }
  } else if (
    [`MarkdownRemark`, `Mdx`].includes(node.internal.type) &&
    getNode(node.parent).internal.type === `File`
  ) {
    const fileNode = getNode(node.parent)
    const parsedFilePath = path.parse(fileNode.relativePath)
    // Add slugs for docs pages
    if (fileNode.sourceInstanceName === `docs`) {
      slug = docSlugFromPath(parsedFilePath)
      locale = "en"

      // Set released status and `published at` for blog posts.
      if (_.includes(parsedFilePath.dir, `blog`)) {
        let released = false
        const date = _.get(node, `frontmatter.date`)
        if (date) {
          released = moment.utc().isSameOrAfter(moment.utc(date))
        }
        createNodeField({ node, name: `released`, value: released })

        const canonicalLink = _.get(node, `frontmatter.canonicalLink`)
        const publishedAt = _.get(node, `frontmatter.publishedAt`)

        createNodeField({
          node,
          name: `publishedAt`,
          value: canonicalLink
            ? publishedAt || url.parse(canonicalLink).hostname
            : null,
        })

        // If an excerpt is defined, use it, otherwise default to autogenerated excerpt
        createNodeField({
          node,
          name: `excerpt`,
          value: node.frontmatter.excerpt || node.excerpt,
        })
      }
    }

    for (let code of langCodes) {
      if (fileNode.sourceInstanceName === `docs-${code}`) {
        // have to remove the beginning "/docs" path because of the way
        // gatsby-source-filesystem and gatsby-source-git differ
        slug = docSlugFromPath(path.parse(fileNode.relativePath.substring(5)))
        locale = code
      }
    }

    // Add slugs for package READMEs.
    if (
      fileNode.sourceInstanceName === `packages` &&
      parsedFilePath.name === `README`
    ) {
      locale = "en"
      slug = `/packages/${parsedFilePath.dir}/`
      createNodeField({
        node,
        name: `title`,
        value: parsedFilePath.dir,
      })
      createNodeField({ node, name: `package`, value: true })
    }
    if (slug) {
      createNodeField({ node, name: `anchor`, value: slugToAnchor(slug) })
      createNodeField({ node, name: `slug`, value: slug })
    }
    if (locale) {
      createNodeField({ node, name: `locale`, value: locale })
    }
  } else if (node.internal.type === `AuthorYaml`) {
    slug = `/contributors/${slugify(node.id, {
      lower: true,
    })}/`
    createNodeField({ node, name: `slug`, value: slug })
  }
}
